/**
 * The goal of this file
 * 
 * This file contains all the tests for VBel2.
 * Not only should this be used to test VBel2 but also to provide usage example for beginners.
 * 
 * Every test is a self contain example of a use case of VBel, it runs it's own http server, etc...
 * 
 * This set of test ensures that the whole code works globally even if there are
 * multiple internal restructurings as we only test the API.
 * 
 * This means that this also works as documentation.
 */


let VBel = require('./index.js'); // import VBel.
let http = require('http');
// let jest = require('@jest/globals');

// Let's define some function needed for testing
// Mainly, to make HTTP request to our VBel2 backend.
/*
Does an HTTP GET request and returns
	{
		statusCode: ...
		headers: ...
		body: ...
	}
*/
async function fetch(url){
	return new Promise((resolve,reject) => {
		try{
			http.get(url, (res) => {
				let rawData = "";
				res.setEncoding('utf8');
				res.on('data', (chunk) => { rawData += chunk; });
	 			res.on('end', () => {
					resolve({
						statusCode: res.statusCode,
						headers: res.headers,
						body: rawData
					});
				});
			});
		}catch(err){
			reject({err});
		}
	});
}

// This function is used in every test to create an HTTP server with
// a different port.
// Every test uses a separate instance of vbel2 to test use cases.
let port = 8087; // start with an uncommon port number above 8080
function makeTestServer(vbel,callback){
	let server = http.createServer({},vbel);
	server.listen(port,async () => {
		callback(port,server);
		port += 1;
	});
}

// -------------------------------------------------------
// Start of the tests.
// -------------------------------------------------------

test('provides documentation when requested.', (done) => {
	let config = {
		doc:true
	};

	let vbel = new VBel(config);
	vbel.compile();

	makeTestServer(vbel,async (port,server) => {
		let result = await fetch(`http://localhost:${port}/doc`);
		expect(result.statusCode).toBe(200);
		expect(result.body).not.toBe("404");
		server.close();
		done();
	});
});
test('provides javascript to access endpoints at the url specified.', (done) => {
	let config = {
		client_script:	"/the/endpoint_script.js" // "/client.js" by default
	};

	let vbel = new VBel(config);
	vbel.compile();

	makeTestServer(vbel,async (port,server) => {
		let result = await fetch(`http://localhost:${port}/the/endpoint_script.js`);
		expect(result.statusCode).toBe(200);
		expect(result.body).toContain("function"); // looks like Javascript
		expect(result.body).toContain("return");
		expect(result.body).toContain("XMLHttpRequest"); // does some AJAX stuff
		server.close();
		done();
	});
});

test('generate the endpoints requested and executes them', (done) => {
	let config = {
		url: "query" // "q" by default
	}
	let vbel = new VBel(config);
	
	let names = ["Alice","Bob","Charly","Dora","Eve"];
	// Some randomness to make sure nothing is hardcoded.
	let rndName = names[Math.floor(Math.random() * names.length)]; // pick random name.
	let rndNumber = Math.random() * 10;

	vbel.endpoint("hello", {
		name:{type:"string"},
		age:{type:"number"}
	},(obj,req,res) => {
		expect(obj.name).toBe(rndName);
		expect(obj.age).toBe(rndNumber);
		vbel.sendSuccess(res,"hello, "+rndName);
	});

	vbel.compile();

	makeTestServer(vbel,async (port,server) => {
		let result = await fetch(`http://localhost:${port}/${config.url}/hello?name=${rndName}&age=${rndNumber}`);
		let responseObject = JSON.parse(result.body);
		expect(responseObject.error).toBeUndefined();
		expect(responseObject.result).toBe("hello, "+rndName);
		done();
		server.close();
	});

});

test('perform proper type checking of endpoint arguments', (done) => {
	let vbel = new VBel({});
	
	let notANumber = "Hello";
	
	let longArgument = ""; // 11 character long string.
	for(let i = 0;i < 11;i++){longArgument += "a"}

	let endpointA = jest.fn();
	let endpointB = jest.fn();
	let endpointC = jest.fn();

	vbel.endpoint("wantNumber", {
		nbr:{type:"number"}
	},(obj,req,res) => {
		endpointA();
		vbel.sendSuccess(res,"ok");
	});
	vbel.endpoint("wantArgument", {
		arg:{type:"string"}
	},(obj,req,res) => {
		endpointB();
		vbel.sendSuccess(res,"ok");
	});
	vbel.endpoint("wantShortArgument", {
		arg:{type:"string",maxlength:10}
	},(obj,req,res) => {
		endpointC();
		vbel.sendSuccess(res,"ok");
	});

	vbel.compile();

	makeTestServer(vbel,async (port,server) => {
		let result,responseObject;
		// make sure all 3 requests result in an error.
		result = await fetch(`http://localhost:${port}/q/wantNumber?nbr=${notANumber}`);
		responseObject = JSON.parse(result.body);
		expect(responseObject.error).not.toBeUndefined();
		expect(responseObject.result).toBeUndefined();

		result = await fetch(`http://localhost:${port}/q/wantArgument`);
		responseObject = JSON.parse(result.body);
		expect(responseObject.error).not.toBeUndefined();
		expect(responseObject.result).toBeUndefined();

		result = await fetch(`http://localhost:${port}/q/wantShortArgument?arg=${longArgument}`);
		responseObject = JSON.parse(result.body);
		expect(responseObject.error).not.toBeUndefined();
		expect(responseObject.result).toBeUndefined();

		expect(endpointA).not.toHaveBeenCalled();
		expect(endpointB).not.toHaveBeenCalled();
		expect(endpointC).not.toHaveBeenCalled();

		server.close();
		done();
	});
});


test('creates SQL tables according to a given model', () => {
	let run_statements = [];
	let get_statements = [];
	let config = {
		sql:{
			_run: (statement,...args) => {
				run_statements.push(statement);
			},
			_get_all: (statement,...args) => {
				get_statements.push(statement);
			}
		}
	}

	let vbel = new VBel(config);

	// let's make a toy sql model to try everything out.
	vbel.table("user",{
		fields:{
			name:{},
			birth:{type:"date"},
			tasks:{
				type: "foreign",
				bind:"task",
				bind_field:"author_id",
			}
		},
	});
	vbel.table("task",{
		fields:{
			name:{},
			content:{},
		}
	});

	vbel.compile();

	// test that the compilation worked from an SQL standpoint

	// no get statement should be made during compilation if an autoMigrate option is not provided
	expect(get_statements.length).toBe(0);
	// Compilation should only run the sql queries to create 2 tables, so only 2 run_statement should be made.
	expect(run_statements.length).toBe(2);

	// The tables should be created in the order of the table declaration.
	expect(run_statements[0].startsWith("CREATE TABLE IF NOT EXISTS user")).toBeTruthy();
	expect(run_statements[1].startsWith("CREATE TABLE IF NOT EXISTS task")).toBeTruthy();

	expect(run_statements[0]).toEqual(expect.stringContaining("id INTEGER")); // an id key was automatically added.
	expect(run_statements[0]).toEqual(expect.stringContaining("name TEXT")); // the text type is used by default
	expect(run_statements[1]).toEqual(expect.stringContaining("author_id INTEGER")); // foreign key was created properly.
	expect(run_statements[1]).toEqual(expect.stringContaining("FOREIGN KEY (author_id) REFERENCES user (id)"));

});