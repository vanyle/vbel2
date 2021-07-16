
const ajax_function = `function get_website(url,postData){
	return new Promise( (resolve) => {
		let httpRequest = new XMLHttpRequest();
		httpRequest.onreadystatechange = () => {
			if(httpRequest.readyState === XMLHttpRequest.DONE){
				resolve(httpRequest.responseText);
			}
		};
		httpRequest.open('POST', url);
		httpRequest.send(postData);
	});
}\n`;

// Return a string representing a Javascript file
// that contains the AJAX functions for the client.

// Feature idea: minify the output of this.

module.exports = (vbel) => {
	let jsStr = ajax_function;


	for(let endpoint_name in vbel.routes){
		let endpoint = vbel.routes[endpoint_name];
		endpoint.variables = endpoint.variables || {};
		let ep_arguments = Object.keys(endpoint.variables).filter((e) => {
			return endpoint.variables[e].provider !== "session"
		});
		if(endpoint.post){
			ep_arguments.push('post_data');
		}

		let current_js_function = "async function "+endpoint_name+"(" + ep_arguments.join(',') + "){\n";
		current_js_function += `	let result = await get_website('${vbel.url}/${endpoint_name}`;
		let isFirst = true;
		for(let arg in endpoint.variables){
			if(endpoint.variables[arg].provider !== 'session'){
				current_js_function += isFirst ? "?" : "&"
				current_js_function += `${arg}='+${arg}+'`;
				isFirst = false;
			}
		}

		current_js_function += "'";
		if(endpoint.post){
			current_js_function += ",post_data";			
		}
		current_js_function += ");\n";
		current_js_function += "	result = JSON.parse(result);\n";
current_js_function += `	if(result.error){
		throw result.error
	}else{
		return result.result;
	}`; // unwrap
		current_js_function += "}\n\n";
		jsStr += current_js_function;
	}

	return jsStr;
};