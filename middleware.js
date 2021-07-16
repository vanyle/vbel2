const url = require('url'); 


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


module.exports = (vbel,req,res,next) => {
	// handle api request.
	// if not for us, call next.
	let url_parts = url.parse(req.url, true);
	let query_path = url_parts.pathname;
	let get_arguments = url_parts.query;
	let host = req.connection.remoteAddress;

	if(query_path === vbel.client_script){ // provide endpoint script
		res.write(vbel.js_interface_string);
		res.end();
		return;
	}
	if(query_path == "/doc" && vbel.doc){ // provide debug documentation
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