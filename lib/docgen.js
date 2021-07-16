const fs = require('fs');
const path = require('path');
const templater = require('./templater.js');

let dirname = path.dirname(__filename);
if(dirname.indexOf(':/') !== -1){
	dirname = dirname.substring(1);
}


// This takes a compiled vbel object and generates a documentation string for it.
// This string is an HTML file that can be sent to a browser or saved somewhere.
module.exports = (vbel) => {
	let doct = fs.readFileSync(path.join(dirname,"/doc-template.html")) + "";
	let endpointStr = "";
	let dbStr = "";

	for(let table_name in vbel.sql_table){
		dbStr += `
		<section class='container px-4 py-5'>
			<h2 class='font-weight-bold'>Table ${table_name}</h2>
			<div class='container py-4'>
			<table class='table'>
			<thead class='thead-light'>
				<tr>
					<th scope='col'>Field name</th>
					<th scope='col'>Type</th>
					<th scope='col'>Is foreign</th>
				</tr>
			</thead>
			<tbody>
		`;
		let t = vbel.sql_table[table_name];
		for(let field in t){
			dbStr += `
				<tr>
					<th scope='row'>${field}</th>
					<th scope='row'>${t[field].type}</th>
					<th scope='row'>${t[field].foreign !== undefined ? "Yes, references "+t[field].foreign  : "No"}</th>
				</tr>
			`;
		}


		dbStr += `
			</tbody>
			</table>
			</div>
		</section>
		<div class="b-example-divider"></div>
		`;
	}

	for(let endpoint_name in vbel.routes){
		// for every endpoint, we display:
		/*
			- [x] the name of the endpoint.
			- [x] a general description of the endpoint if one is available.
			- a line of js calling the endpoint
			- [x] a url to call the endpoint with GET/POST before it, as a <a> tag with sane default arguments (type:number => number used as default)
			- [x] a table with the arguments required, their types and the constraints associated with every argument
			- a description of the permissions required to call the endpoint. (say custom if it's a function for example)
			- if the endpoint was generated automatically or if it was custom.
			
			- the sql executed by the endpoint if possible.
		*/
		let endpoint = vbel.routes[endpoint_name];

		let exampleUrl = `${vbel.url}/${endpoint_name}`;
		let isFirst = true;
		for(let arg in endpoint.variables){

			if(endpoint.variables[arg].provider !== 'session'){
				exampleUrl += isFirst ? "?" : "&"
				exampleUrl += `${arg}=`;
				if(endpoint.variables[arg].type === 'string'){
					exampleUrl += `${arg}`;
				}else if(endpoint.variables[arg].type === 'integer'){
					exampleUrl += "0";
				}else if(endpoint.variables[arg].type === 'number'){
					exampleUrl += "0.0";
				}else if(endpoint.variables[arg].type === 'date'){
					exampleUrl += new Date().toISOString()
				}else{
					exampleUrl += `data`;
				}

				isFirst = false;
			}
		}

		endpointStr += `
		<section class='container text-left px-4 py-5'>
		<h2 class='font-weight-bold'>${endpoint_name}</h2>
		<p>${vbel.routes[endpoint_name].description || ""}</p>
		<h3>URL</h3>
		<p>GET <a href="${exampleUrl}">${exampleUrl}</a></p>

		<h3>Arguments</h3>
		<table class='table'>
		<thead class='thead-light'>
			<tr>
				<th>Name</th>
				<th>Provider</th>
				<th>Type</th>
				<th>Min Length</th>
				<th>Max Length</th>
			</tr>
		</thead>
		<tbody>
		`;

		for(let arg in endpoint.variables){
			let c = endpoint.variables[arg];
			let ctype = c.type === "blob" ? "blob (as base64)" : c.type; 
			endpointStr += `
				<tr>
				<th scope='row'>${arg}</li>
				<th scope='row'>${c.provider === "session" ? "session" : "GET"}</li>
				<th scope='row'>${ctype || "Any"}</li>
				<th scope='row'>${c.minlength !== undefined ? c.minlength : "0"}</li>
				<th scope='row'>${c.maxlength !== undefined ? c.maxlength : "Infinity"}</li>
				</tr>
			`;
		}
		endpointStr += `</tbody></table>`;

		let isAutoGen = endpoint.auto;
		// can we find a table + method matching the endpoint ?

		if(isAutoGen){

			endpointStr += `
				<h3>Permissions needed to use this endpoint</h3>
			`
			if(endpoint.permission){
				if(endpoint.permission === "all"){
					endpointStr += `<p>Anyone can use this endpoint</p>`;
				}else if(endpoint.permission === "none"){
					endpointStr += `<p>Noboby can use this endpoint</p>`;
				}else if(endpoint.permission === "server"){
					endpointStr += `<p>This endpoint is used by the server internally but cannot be called from the outside</p>`;
				}else if(typeof endpoint.permission === "object"){
					if(endpoint.permission.match){
						endpointStr += `<p>
						The id of the user needs to match the field ${endpoint.permission.match}
						</p>`;
					}else
					if(endpoint.permission.contains){
						endpointStr += `<p>
						The id of the user needs to be contained in the field ${endpoint.permission.contains}
						</p>`;
					}else
					if(endpoint.permission.notmatch){
						endpointStr += `<p>
						The id of the user needs to <b>NOT</b> match the field ${endpoint.permission.match}
						</p>`;
					}else
					if(endpoint.permission.notcontains){
						endpointStr += `<p>
						The id of the user needs to <b>NOT</b> be contained in the field ${endpoint.permission.match}
						</p>`;
					}
				}else if(typeof endpoint.permission === "function"){
					endpointStr += `
					<div class='my-2'>
					A custom function named ${endpoint.permission.name} is used to check permissions.
					It's source code starts with:
					<pre><code>${endpoint.permission.toString().substring(0,200)}</code></pre>
					</div>
					`; // we display the first 200 characters of the function.			
				}
			}else{
				endpointStr += `<p>VBel2 does not limit access to this endpoint.</p>`;
			}


			if(endpoint.sqlQuery){
				endpointStr += `<h3>SQL Query</h3>`;
				endpointStr += `<div><pre><code>${endpoint.sqlQuery}</code></pre></div>`
			}else{
				endpointStr += `<p>The behavior of this VBel2 endpoint is custom.</p>`
			}

		}

		endpointStr += `
			<div>
			Generated automatically by VBel2:
			<span class='font-weight-bold'>${isAutoGen ? "Yes" : "No"}</span>
			</div>
		`;



		endpointStr += `
		</section>
		<div class="b-example-divider"></div>
		`;
	}


	let data = {
		client_script: vbel.client_script,
		dbDescription: dbStr,
		endpointsDescription: endpointStr,
		appName: vbel.appname || "VBel2 App",
	};
	doct = templater(doct,data);
	return doct;
}