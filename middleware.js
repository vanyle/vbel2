"use strict";
const url = require('url'); 
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const session_cookie_name = 'session_id';

let session_memory_store = {

};


function make_salt(){
	const buf = crypto.randomBytes(32);
	return buf.toString('hex');
}
function sha256(msg){
	return crypto.createHash('sha256').update(msg, 'utf8').digest().toString('hex');
}
function make_signable(s,secret){
	return s+"."+sha256(s+"."+secret);
}
function validate(s,secret){
	// for all x, validate(sign(x)) === true
	// for all y, if there is not x such that sign(x) = y, then, validate(y) === false
	let d = s.split(".");
	return d[1] === sha256(d[0]+"."+secret);
}

function sendError(res,description,code,fatal){
	if(typeof description !== "string"){
		consoleError("issue with sendError(res,description,code), description is not a string. Did you swap the arguments or forgot to provide res ?");
		console.trace();
		return;
	}
	code = code || -1;
	description = description || "Unexpected error";
	res.write(JSON.stringify({error:{description,code}}));
	res.end();
	if(fatal === true){
		process.exit();
	}
}

function parseCookies(request) {
	let list = {}, rc = request.headers.cookie;

	rc && rc.split(';').forEach((cookie) => {
		let parts = cookie.split('=',2);
		list[parts[0].trim()] = decodeURI(parts[1]);
	});

	return list;
}
function setCookie(res,key,val){
	res.writeHead(200,{
		'Set-Cookie': key+'='+val,
	});
}

function readSessionStore(session_id){
	return session_memory_store[session_id];
}
function writeSessionStore(session_id,data){
	session_memory_store[session_id] = data;
}



module.exports = (vbel,req,res,next) => {
	// handle api request.
	// if not for us, call next.
	let url_parts = url.parse(req.url, true);
	let query_path = url_parts.pathname;
	let get_arguments = url_parts.query;
	let host = req.connection.remoteAddress;


	let readStore = readSessionStore;
	let writeStore = writeSessionStore;
	if(vbel.store && typeof vbel.store.read === "function"){
		readStore = vbel.store.read;
	} 
	if(vbel.store && typeof vbel.store.write === "function"){
		writeStore = vbel.store.write;
	}

	// session implementation
	if(typeof req.session === "undefined"){ // if a session implementation is not given.
		let cookies = parseCookies(req);
		req.cookies = cookies;
		let cookieHeaderValue = null;
		let session_id = null;
		let session_data = null;

		let isValid = typeof req.cookies[session_cookie_name] === "string"
		if(isValid){
			session_id = cookies[session_cookie_name];
			isValid = validate(session_id,vbel.cookie_secret);
		}
		// fetch session data associated with the cookie.
		if(isValid){
			session_data = readStore(session_id);
			if(typeof session_data === "object"){
				req.session = session_data.data;
				session_data.lastUsed = new Date();
			}else{
				session_data = {
					data:{},
					lastUsed: new Date()
				};
				req.session = session_data.data;
			}
		// set a new cookie and create an update session object.
		}else{
			session_id = make_signable(make_salt(),vbel.cookie_secret);
			session_data = {
				data:{},
				lastUsed: new Date()
			};
			req.session = session_data.data;
			res.setHeader("Set-Cookie",session_cookie_name+"="+session_id)
		}

		res.on("close", () => {
			// write session back to store (only if not trivial), this saves space in the store.
			if(session_data && Object.keys(session_data).length !== 0){
				writeStore(session_id,session_data);
			}
		});
	}

	if(query_path === vbel.client_script){ // provide endpoint script
		res.write(vbel.js_interface_string);
		res.end();
		return;
	}

	for(let paths in vbel.files){
		if(query_path.startsWith(paths)){
			let striped_query = query_path.substring(paths.length);
			let f_path = vbel.files[paths].filename;

			let file_path = f_path + '/' + path.normalize(striped_query);
			// remove ../.. from file_path.
			while(file_path.endsWith('/')){
				file_path = file_path.substring(0,file_path.length-1);
			}
			file_path = path.normalize(file_path);

			if(!fs.existsSync(file_path)){
				continue;
			}

			let file_info = null;
			try{
				file_info = fs.lstatSync(file_path);
			}catch(err){
				continue;
			}
			if(file_info.isFile()){
				let range = req.headers.range;
				let content_type = "application/octet-stream";

				// we provide content type for common file types.
				if(file_path.endsWith('.css')){
					content_type = "text/css";
				}else if(file_path.endsWith('.html')){
					content_type = "text/html";
				}else if(file_path.endsWith('.js')){
					content_type = "application/javascript";
				}else if(file_path.endsWith('.png')){
					content_type = "image/png";
				}else if(file_path.endsWith('.jpg')){
					content_type = "image/jpg";
				}else if(file_path.endsWith('.txt')){
					content_type = "text/plain";
				}

				if(!range){
					res.setHeader("Content-Type",content_type);

					// stream file output to res.
					let stream = fs.createReadStream(file_path);
					stream.on('data',(chunk) =>{
						res.write(chunk);
					});
					stream.on('end',() => {
						res.end();
					});
					return;
				}else{
					// needed to serve large files.
					let stats = fs.statSync(fpath);
					let positions = range.replace(/bytes=/, "").split("-");
					let start = parseInt(positions[0], 10);
					let total = stats.size;
					let end = positions[1] ? parseInt(positions[1], 10) : total - 1;
					let chunksize = (end - start) + 1;

					res.setHeader("Content-Range","bytes "+start+"-"+end+"/"+total);
					res.setHeader("Accept-Ranges","bytes");
					res.setHeader("Content-Length",chunksize);
					res.setHeader("Content-Type",content_type);
					res.statusCode = 206;

					let stream = fs.createReadStream(fpath, { start: start, end: end })
					.on("open", function() {
						stream.pipe(res);
					}).on("error", function(err) {
						res.end(err);
					});
				}

			}else{
				// not a file, probably a directory.
				// we don't provide a directory view.
				continue;
			}

		}
	}

	if(query_path === "/doc" && vbel.doc){ // provide debug documentation
		res.write(vbel.debug_template);
		res.end();
		return;
	}
	let parts = query_path.substring(1).split("/",2);			

	if(parts.length == 2 && parts[0] === vbel.url){ // provide the endpoints
		let type = parts[1];

		for(let endpointName in vbel.routes){
			if(endpointName === type){
				let curr = vbel.routes[endpointName];

				let argument_object = {};

				// Check if the request is valid.
				for(let varname in curr.variables){
					let provided = null;

					if(curr.variables[varname].provider === "session"){
						provided = req.session[varname];
					}else{
						provided = get_arguments[varname];
					}


					if(provided === null){
						res.write("{'error':'Variable "+varname+" is missing'}");
						res.end();
						return;
					}

					// Start by checking the length requirements so that we can
					// protect ourselfs from people sending big queries trying to overload us.
					if(typeof provided === "string"){
						if(typeof curr.variables[varname].maxlength === "number" && provided.length > curr.variables[varname].maxlength){
							sendError(res,`Variable ${varname} is malformed`);
							return;
						}
						if(typeof curr.variables[varname].minlength === "number" && provided.length < curr.variables[varname].minlength){
							sendError(res,`Variable ${varname} is malformed`);
							return;
						}
					}

					// The valid types are:
					// string, number, date, integer, blob
					// for date, we attempt to parse it as an ISO date.
					// for blob, we attempt to convert it to a buffer via base64
					// this allows us to easily display images that are stored in b64 client size.
					// the only penalty is an increase in binary data size when transfering data of about ~33%
					// note that there is no storage penalty

					// Attempt to cast to number:
					if(curr.variables[varname].type === "number" || curr.variables[varname].type === "integer"){
						let provided_number = Number(provided);
						if(!isNaN(provided_number)){
							provided = provided_number;
						}else{
							sendError(res,`Variable ${varname} is malformed`);
							return;
						}
					}
					if(curr.variables[varname].type === "integer"){
						if(Math.floor(provided) !== provided){
							sendError(res,`Variable ${varname} is malformed`);
							return;
						}
					}
					if(curr.variables[varname].type === "date"){
						let d = new Date(provided);
						if(isNaN(d.getTime())){
							sendError(res,`Variable ${varname} is malformed`);
							return;
						}
						provided = d;
					}
					if(curr.variables[varname].type === "blob"){
						try{
							let buf = Buffer.from(provided,'base64');
							// we have no way to check if the base64 is valid.
							// in my tests, Buffer.from never returned errors for this.
							provided = buf;
						}catch(err){
							sendError(res,`Variable ${varname} is malformed`);
							return;
						}
					}			

					if(curr.variables[varname].type === "string" && typeof provided !== "string"){
						sendError(res,`Variable ${varname} is malformed`);
						return;
					}

					if(typeof provided === "undefined"){
						sendError(res,`Variable ${varname} is malformed`);
						return;
					}

					argument_object[varname] = provided;

				}
				// request appears to be valid: all the arguments are correct, we can call the handler.
				curr.handler(argument_object,req,res);

				return;
			}
		}
	}

	if(typeof next === 'function'){
		next(); // not for us.
	}else{
		// we are not using express.
		// in theory, we could implement more stuff in this case:
		// providing file, session middleware, etc..
		// the issue is that this would mean rewritting the wheel.
		// so I would implement it.
		res.write('404');
		res.end();
	}
}