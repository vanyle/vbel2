// This is the template engine used by vbel.
/*
While not having a ton of features,
it's fast, simple and works well.

It's main purpose is to generate the documentation as vbel is uses ajax to transmit data.
You could use it to serve your files if needed though.

Usage:

templateString = `
	Hello @resolve{human}, this is @resolve{robot} speaking.

	Here is your file: @include{thing.txt}
`;
data = {
	human: "Bob",
	robot: "Jerry",
};

templater(templateString,data,basepath);

Note that for safety reasons, you cannot access the parent directory when including:
This: @include{../thing.txt} is not possible

*/
const fs = require('fs');
const path = require('path');

let dirname = path.dirname(__filename);
if(dirname.indexOf(':/') !== -1){
	dirname = dirname.substring(1);
}

module.exports = (templateString, data, basepath) => {
	let tomatch = "@include{";
	let tomatch2 = "@resolve{";

	let include_start_index = 0;
	let include_stop_index = 0;

	basepath = basepath || dirname;
	let i = 0; // str pointer

	while(i < templateString.length){
		
		if(templateString.substring(i,i + tomatch2.length) === tomatch2){		
			i += tomatch2.length;
			include_start_index = i;
			while(templateString[i] !== '}' && i < templateString.length) i++;
			include_stop_index = i;

			let resolve_variable = templateString.substring(include_start_index,include_stop_index);
			if(data[resolve_variable] === undefined){
				console.error(`Warning: substitution failed in process_file_content, data["${resolve_variable}"] is not defined`);
				console.trace();
				templateString = templateString.substring(0,include_start_index - tomatch2.length) + templateString.substring(include_stop_index+1);
			}else{
				templateString = templateString.substring(0,include_start_index - tomatch2.length) + data[resolve_variable] + templateString.substring(include_stop_index+1);
			}
			i = include_start_index - tomatch.length;
		}else if(templateString.substring(i,i + tomatch.length) === tomatch){
			i += tomatch.length;
			include_start_index = i;
			while(templateString[i] !== '}' && i < templateString.length) i++;
			include_stop_index = i;

			// perform substitution.
			let file_path = path.join(basepath,templateString.substring(include_start_index,include_stop_index));
			try{
				let substitution = fs.readFileSync(file_path);
				templateString = templateString.substring(0,include_start_index - tomatch.length) + substitution + templateString.substring(include_stop_index+1);
				i = include_start_index - tomatch.length;
			}catch(err){
				console.error(`Warning, substitution failed in process_file_content for ${filePath}: `);
				console.trace();
				console.error(err.message);
			}
		}
		i ++;
	}
	return templateString;
}; 