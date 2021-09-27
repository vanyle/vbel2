
// vanyle backend library
"use strict";

const docgen = require("./lib/docgen.js");
const jsgen = require("./lib/jsgen.js");
const middleware = require("./middleware.js");
const fs = require("fs");
const http = require("http");

// TODO: put the three following functions in a separate file
function consoleError(msg){
	const COLOR_RED = `\x1b[31m`;
	const COLOR_RESET = `\x1b[0m`;
	console.error(`${COLOR_RED}[ERROR]${COLOR_RESET} ${msg}`);
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
function sendSucess(res,object){
	if(object === undefined){
		consoleError("issue with sendSucess(res,object), object is not an object. Did you swap the arguments or forgot to provide res ?");
		console.trace();
		return;
	}
	res.write(JSON.stringify({result:object}));
	res.end();
}


class VBel extends Function{
	constructor(config){
		super('...args', 'return this.__self__.__call__(...args)');
		let self = this.bind(this);
	    this.__self__ = self;

	    config = config || {};

		self.compiled = false;
		self.routes = {};
		self.table_info = {};
		self.sql_table = null; // generated from table_info inside compile()

		self.files = {};
		self.folders = {};

		self.appname = config.appname;
		self.url = config.url || "q";
		self.client_script = config.client_script || "/client.js";
		self.doc = config.doc || false;

		self.js_interface_string = "";
		self.debug_template = "";

		self.sql = config.sql;
		if(self.sql === undefined){
			console.error(`config.sql is not defined.
Tou need to provide sql functions to use the SQL related features of VBel2.

To disable this warning, add this:
sql:{
	_run: (statement,...args) => {},
	_get_all: (statement,...args) => {}
}
to your config or at least:
sql:null`);
			
		}


	    return self;
	}
	_parsePermission(permissionValue,objectId,objectType,req,obj){
		if(typeof permissionValue === "string"){
			if(permissionValue === "none"){
				return false;
			}else if(permissionValue === "all"){
				return true;
			}else if(permissionValue === "server"){
				return req.isServerSideRequest === true;
			}else{
				consoleError(`Invalid permissionValue: ${permissionValue}`);
				console.trace();
				return false;
			}
		}
		let userid = req.session.user_id;

		if(typeof permissionValue === "object"){
			if(userid === undefined){
				// We can't match anything if the user if not logged in.
				return false;
			}

			if(typeof permissionValue.match === "string"){
				let field = permissionValue.match;
				let result = field === "id" ? objectId : this.getDatabaseValue(objectType,objectId,field)[0][field];
				return result !== undefined && result === userid;
			}else if(typeof permissionValue.contains === "string"){
				let field = permissionValue.contains;
				let result = field === "id" ? objectId : this.getDatabaseValue(objectType,objectId,field)[0][field];
				return result !== undefined && result.includes(field);
			}else if(typeof permissionValue.notmatch === "string"){
				// This is less usefull than the rest but I can see some use for some games
				// where everybody knows something except you.
				let field = permissionValue.match;
				let result = field === "id" ? objectId : this.getDatabaseValue(objectType,objectId,field)[0][field];
				return result !== undefined && result !== userid;
			}else if(typeof permissionValue.notcontains === "string"){
				// Main use is to ban people.
				let field = permissionValue.contains;
				let result = field === "id" ? objectId : this.getDatabaseValue(objectType,objectId,field)[0][field];
				return result !== undefined && !result.includes(field);
			}else{
				consoleError(`Invalid permissionValue: ${JSON.stringify(permissionValue)}`);
				console.trace();
				return false;
			}
		}

		if(typeof permissionValue === "function"){
			let targetObject = this.getDatabaseValue(objectType,objectId)[0];
			// make sure be return a bool and not undefined or something.
			return permissionValue(userid,targetObject,req,obj) === true;
		}

	}

	isDatabaseIdValid(objectType,objectId){
		let sqlRequest = `SELECT id FROM ${objectType} WHERE id = ?`;
		let result = this.sql._get_all(sqlRequest,objectId);
		return result.length === 1;
	}

	// Used to retreive parts of the database.
	// very little sanitation is done on the objectType and objectField arguments of this function.
	// these should not be controlled by the user except objectId that is.
	// Does not implement any permission of any kind.
	// Returns an array containing the results (which will by of size 1 for non foreign fields)
	// Returns an empty array if an error is encoutered.
	getDatabaseValue(objectType,objectId,objectField,requestOnly){
		if(objectId === null || objectId === undefined){
			return [];
		}
		if(typeof this.table_info[objectType] !== "object"){
			consoleError(`Invalid objectType ${objectType}}`);
			console.trace();
			return [];
		}

		let sqlRequest = `SELECT `;
		let containsBlob = false;

		let idfield = "id";

		if(objectField === undefined){
			sqlRequest += `* FROM ${objectType} WHERE `;
		}else if(typeof objectField === "string"){
			if(this.sql_table[objectType][objectField] === undefined && this.table_info[objectType].fields[objectField] === undefined){
				consoleError(`Invalid objectField ${objectField} for request in table ${objectType}`);
				console.trace();
				return [];
			}
			let fieldData = this.table_info[objectType].fields[objectField] || {};
			containsBlob = containsBlob || fieldData.type == "blob";
			if(fieldData.type === "foreign"){
				let bindTable = fieldData.bind;
				let bindField = fieldData.bind_field;
				if(this.table_info[bindTable] === undefined){
					// this should never happen because of compilation.
					consoleError(`Field ${objectField} in table ${objectType} references an invalid table: ${bindTable}`);
					console.trace();
					return [];
				}
				sqlRequest += this.table_info[bindTable].defaultSelector; // += "id" by default
				sqlRequest += ` FROM ${bindTable} ${this.table_info[bindTable].joinOnDefault} WHERE `;
				idfield = `${bindTable}.${bindField}`;
			}else{
				sqlRequest += `${objectField} FROM ${objectType} WHERE `;
			}
		}else{
			consoleError(`Invalid objectField ${objectField} for request in table ${objectType}`);
			console.trace();
			sqlRequest += "* ";
		}

		// add WHERE clauses based on objectId
		if(typeof objectId === "string" || typeof objectId === "number"){
			sqlRequest += `${idfield} = ?`;
			objectId = [objectId];
		}else if(typeof objectId === "object" && objectId !== null){
			// {customField:customValue,otherCustomField:otherCustomValue}
			let arr = [];
			let newobjId = [];
			for(let field in objectId){
				arr.push(`${field} = ?`);
				newobjId.push(objectId[field]);
			}

			if(arr.length == 0){
				sqlRequest += `1 = 1`;
			}else{
				sqlRequest += arr.join(' AND ');
			}
			objectId = newobjId;
		}else{
			consoleError(`Unrecognized objectId option ${objectId} for request in table ${objectType}`);
			console.trace();
			return [];
		}

		if(requestOnly){
			return sqlRequest;
		}

		try{
			let results = null;
			results = this.sql._get_all.apply(null,[sqlRequest,...objectId]);
			// convert buffers to blob string
			if(containsBlob){
				for(let i = 0;i < results.length;i++){
					for(let field in results[i]){
						if(Buffer.isBuffer(results[i][field])){
							results[i][field] = results[i][field].toString('base64');
						}
					}
				}
			}
			return results;
		}catch(err){
			consoleError(`Bad SQL request from getDatabaseValue: ${sqlRequest}`);
			console.trace();
			console.log(err.message);
		}
		return [];
	}

	// The same remarks as getDatabaseValue apply.
	// Returns true on success and false on failure
	setDatabaseValue(objectType,objectId,objectField,newValue,requestOnly){
		if(typeof this.table_info[objectType] !== "object"){
			consoleError(`Invalid objectType ${objectType}}`);
			console.trace();
			return false;
		}


		let sqlRequest = `UPDATE ${objectType} SET `;

		if(typeof objectField === "string"){
			if(this.table_info[objectType].fields[objectField] === undefined){
				consoleError(`Invalid objectField ${objectField} for request in table ${objectType}`);
				console.trace();
				return false;
			}
			let fieldData = this.table_info[objectType].fields[objectField];
			if(fieldData.type === "foreign"){
				consoleError(`Unable to set the value of the foreign field ${objectField} in ${objectType}. Use methods to do this instead.`);
				console.trace();
				return false;
			}else{
				sqlRequest += `${objectField} = ? WHERE id = ?`;
			}
		}else{
			consoleError(`Invalid objectField ${objectField} for request in table ${objectType}`);
			console.trace();
			return false;
		}

		if(requestOnly){
			return sqlRequest;
		}

		if(newValue instanceof Date){
			newValue = newValue.toISOString();
		}

		try{
			return this.sql._run(sqlRequest,newValue,objectId);
		}catch(err){
			consoleError(`Bad SQL request from setDatabaseValue: ${sqlRequest}`);
			console.trace();
			console.log(err.message);
		}
		return false;
	}


	// Used to generate database tables and routes that go with those.
	table(name,content){
		this.compiled = false;
		this.table_info[name] = content;
	}

	// Used to manually define endpoints.
	endpoint(name,variables,handler,description){
		this.compiled = false;
		if(this.routes[name] !== undefined){
			// Warning.
			console.log(`Warning, you are trying to override the endpoint named ${name}.`);
		}

		if(handler === undefined){
			this.routes[name] = variables;
		}else{
			this.routes[name] = {variables,handler,description};
		}
	}

	// Used to serve static files. Option for compilation purposes (templating, caching, etc ...)
	// Options is currently not implemented.
	// Note that if filename refers to a directory, this will provide the entire directory.
	file(href,filename,options){
		this.files[href] = {filename,options};
 	}

	// Used to call endpoints without any HTTP request.
	// In this case, the res and req object are simulated.
	// This might fail if the endpoint is highly custom.
	async callEndpoint(name,options){

		return new Promise( (resolve,reject) => {
			let body = "";
			let req = {
				session:{user_id: options.user_id},
				isServerSideRequest: true
			};
			let res = {
				write:(d) => {
					if(d !== undefined){
						body += d;
					}
				},
				end:(d) => {
					if(d !== undefined){
						body += d;
					}
					let data = {};
					try{
						data = JSON.parse(body);
					}catch(err){
						// non json response, because the endpoint is custom ...
						consoleError(`callEndpoint(${name}) failed, the response is not JSON. You should avoid calling callEndpoint for custom endpoints.`);
						reject(err);
					}
					if(data.error){
						reject(data.error);
					}else{
						resolve(data.result);
					}
				}
			};
			this.routes[name].handler(options,req,res);
		});
	}

	// Needs to be called after all the endpoints are defined
	// Creates the SQL tables needed and generates the endpoints based on the data structure defined.
	// Also, generate the documentation for those endpoints.
	compile(){

		// create the required SQL table with all the foreign fields and stuff.
		// we don't care about permissions for now.
		let sqlTableData = {};
		// used to prevent people from making spelling errors on foreign fields
		let tableValidation = {};
		for(let table_name in this.table_info){
			if(typeof this.table_info[table_name] !== 'object'){
				consoleError(`Invalid table ${table_name}, the argument provided is not an object.`);
				process.exit(1);
			}
			this.table_info[table_name].fields = this.table_info[table_name].fields || {};
			this.table_info[table_name].defaultSelector = this.table_info[table_name].defaultSelector || "id";
			this.table_info[table_name].joinOnDefault = this.table_info[table_name].joinOnDefault || "";


			sqlTableData[table_name] = sqlTableData[table_name] || {};
			tableValidation[table_name] = true;
			sqlTableData[table_name].id = {type:"INTEGER",primary:true};

			for(let field_name in this.table_info[table_name].fields){
				let fieldInfo = this.table_info[table_name].fields[field_name];
				if(field_name === "id"){
					continue; // id must be of type integer.
				}
				if(fieldInfo.type === "foreign"){
					// generate the type in another table.
					if(sqlTableData[fieldInfo.bind] === undefined){
						if(!tableValidation[fieldInfo.bind]){
							tableValidation[fieldInfo.bind] = false;
						}
						if(this.table_info[fieldInfo.bind] !== undefined && this.table_info[fieldInfo.bind].isuser){
							consoleError(`Invalid foreign reference: ${field_name} inside ${table_name} references a user table, which is illegal.`);
							process.exit(1);
							// This error is hard to explain, but there are sql related reasons for why we don't allow this.
						}
						sqlTableData[fieldInfo.bind] = {};
						sqlTableData[fieldInfo.bind][fieldInfo.bind_field] = {
							type:"INTEGER",
							foreign: table_name
						}
					}
					sqlTableData[fieldInfo.bind][fieldInfo.bind_field] = {type:"INTEGER",foreign:table_name};
				}else if(fieldInfo.type === "integer"){
					sqlTableData[table_name][field_name] = {type:"INTEGER"};
				}else if(fieldInfo.type === "number"){
					sqlTableData[table_name][field_name] = {type:"REAL"};
				}else if(fieldInfo.type === "string" || fieldInfo.type === undefined){
					sqlTableData[table_name][field_name] = {type:"TEXT"};
				}else if(fieldInfo.type === "date"){
					sqlTableData[table_name][field_name] = {type:"TEXT"}; // ISO8601 string
				}else if(fieldInfo.type === "blob"){
					sqlTableData[table_name][field_name] = {type:"BLOB"};
				}else{
					consoleError(`Unknown field type ${fieldInfo.type} inside table ${table_name}. Please specify a valid type.`);
					consoleError(`Valid types are: foreign, integer, number, string, date, blob`);
					process.exit(1);
				}
			}
		}
		// Check for invalid foreign references
		for(let i in tableValidation){
			if(tableValidation[i] === false){
				consoleError(`Invalid foreign reference: table ${i} is mentionned but never explicitly created.`);
				process.exit(1);
			}
		}

		// Now, generate the routes associated with the table described.
		for(let table_name in sqlTableData){
			let sqlQuery = `CREATE TABLE IF NOT EXISTS ${table_name} (\n`;
			let isFirst = true;
			for(let field in sqlTableData[table_name]){
				if(!isFirst){
					sqlQuery += `,\n`;
				}
				isFirst = false;
				let finfo = sqlTableData[table_name][field];
				sqlQuery += `	${field} ${finfo.type}`;
				if(finfo.primary){
					sqlQuery += ` PRIMARY KEY`;
				}
			}
			// handle foreign stuff:
			for(let field in sqlTableData[table_name]){
				let finfo = sqlTableData[table_name][field];
				if(finfo.foreign !== undefined){
					sqlQuery += `,\n	FOREIGN KEY (${field}) REFERENCES ${finfo.foreign} (id)\n`;
					sqlQuery += `		ON DELETE CASCADE ON UPDATE NO ACTION`
				}
			}
			sqlQuery += "\n)";

			this.sql._run(sqlQuery);
		}

		this.sql_table = sqlTableData; // We are done generating the SQL tables !

		/* Now, generate the endpoints associated with all this.
		 This is the most complicated part.
		 We generate 2 types of endpoints, methods and accessors
		 	Methods are the ones described in the "methods" field, they allow to create, delete or list objects in various ways
		 	valid methods are: create, delete, list, search, count
		
			Accessors are getters and setters generated for each field based on permission levels.
			No accessor is generated if the permission is set to none for example.

			We start by generating accesors.
		*/

		for(let table_name in this.table_info){
			
			// Add accessors
			for(let field_name in this.table_info[table_name].fields){
				let finfo = this.table_info[table_name].fields[field_name];
				let isuser = this.table_info[table_name].isuser;
				finfo.read = finfo.read || "all"; 
				finfo.write = finfo.write || "none"; 

				if(finfo.read !== "none"){
					// TODO: in case the field is foreign, provide 2 read options:
					// Let's say be have user.comments = Array.
					// Then, we need: get_user_comments(user_id) -> Array
					// And: get_comment_author(comment_id) -> user_id
					let variables = {};
					//if(isuser){
					//	variables["user_id"] = {type:"integer",provider:"session"};
					//}else{
						variables["id"] = {type:"integer"};
					//}
					if(typeof finfo.read === "object"){
						variables["user_id"] = {type:"integer",provider:"session"};
					}

					this.endpoint(`get_${table_name}_${field_name}`,variables, (obj,req,res) => {
						let id;
						//if(isuser){
						//	id = obj.user_id;
						//}else{
							id = obj.id;
						//}
						// check if permission is valid.
						// _parsePermission also make sure the object with id exists.
						let isAllowed = this._parsePermission(finfo.read,id,table_name,req,res,obj);
						if(!isAllowed){
							sendError(res,"Unauthorized");
							return;
						}
						// TODO: preprocess the result of getDatabaseValue.
						// for example, do base64 encoding for blobs, etc ...
						sendSucess(res,this.getDatabaseValue(table_name,id,field_name));

					},`Retreive the field ${field_name} from the table ${table_name}`);
					this.routes[`get_${table_name}_${field_name}`].auto = true;
					this.routes[`get_${table_name}_${field_name}`].permission = finfo.read;
					this.routes[`get_${table_name}_${field_name}`].sqlQuery = this.getDatabaseValue(table_name,0,field_name,true);
				}
				// foreign types represents arrays in a way. It does not make sens to set an array this way.
				// to edit foreign field, you need to use the create/delete methods of the corresponding table.
				if(finfo.write !== "none" && finfo.type !== "foreign"){
					let variables = {val:{type:finfo.type}};
					//if(isuser){
					//	variables["user_id"] = {type:"integer",provider:"session"};
					//}else{
						variables["id"] = {type:"integer"};
					//}
					if(typeof finfo.write === "object"){
						variables["user_id"] = {type:"integer",provider:"session"};
					}

					this.endpoint(`set_${table_name}_${field_name}`,variables,(obj,req,res) => {
						let id;
						//if(isuser){
						//	id = obj.user_id;
						//}else{
							id = obj.id;
						//}
						// check if permission is valid.
						// _parsePermission also make sure the object with id exists.
						let isAllowed = this._parsePermission(finfo.write,id,table_name,req,res,obj);
						if(!isAllowed){
							sendError(res,"Unauthorized");
							return;
						}
						let isok = this.setDatabaseValue(table_name,id,field_name,obj.val);
						if(isok){
							sendSucess(res,"ok");
						}else{
							sendError(res,"Unknown error");
						}

					},`Set the field ${field_name} of the table ${table_name}`);
					this.routes[`set_${table_name}_${field_name}`].auto = true;
					this.routes[`set_${table_name}_${field_name}`].permission = finfo.write;
					this.routes[`set_${table_name}_${field_name}`].sqlQuery = this.setDatabaseValue(table_name,0,field_name,null,true);
				}
			}

			// Add methods.
			/*
			Method fields:
				permissions: same as read/write for accessors
				handle: "auto" or (obj,req,res)=>{} used to define what to do / use the default behavior
				"auto" is the default value.
				arguments: what arguments to use. If not provided, we attempt to find sane defaults.
				If arguments is provided but handle is auto, we complain.
			*/

			this.table_info[table_name].methods = this.table_info[table_name].methods || {};
			for(let method_name in this.table_info[table_name].methods){
				let method_options = this.table_info[table_name].methods[method_name];
				if(method_name === "create"){
					// endpoint to create an element in this table.
					// we first need to know what variables are needed for this method.
					// we need 1 argument per field except for foreign fields.
					// for imported fields, is the imported field comes from isuser,
					// we assume it's the one for the user making the request.
					// if not, we add the id of the provided field as an argument and
					// we check that said id is valid before creation.

					// Note that this automatic approch can fail. For example if we need to create a "follower"
					// relation between 2 users, this algorithm will wrongly assume that we don't need a "followed"
					// argument. In this case, manually defining the handle is required.
					let variables = {};
					let foreign_id_variables = {};
					let autoGeneratedVariables = this.table_info[table_name].methods["create"].generate || {};
					for(let generatedField in autoGeneratedVariables){
						if(typeof autoGeneratedVariables[generatedField] !== "function"){
							consoleError(`Bad generated field value inside table ${table_name} for field ${generatedField}. The generator provided is not a function`);
							console.trace();
							method_options.permission = "none";
						}
					}

					for(let field in sqlTableData[table_name]){
						if(field === "id") continue;
						if(autoGeneratedVariables[field] !== undefined) continue;

						let finfo = sqlTableData[table_name][field];

						if(finfo.foreign !== undefined){
							let referenced_table = this.table_info[finfo.foreign];
							if(referenced_table.isuser){
								variables["user_id"] = {provider:"session",type:"integer"};
							}else{
								variables[`${finfo.foreign}_id`] = {type:"integer"};
								foreign_id_variables[`${finfo.foreign}_id`] = finfo.foreign;
							}
						}else{
							let ftype = this.table_info[table_name].fields[field].type;
							variables[table_name+"_"+field] = {type:ftype};
						}
					}
					
					let permission = method_options.permission || "all";

					if(method_options.handle !== "auto" && method_options.handle !== undefined){
						let args = method_options.variables || variables;
						this.endpoint("create_" + table_name,args,(obj,req,res) => {
							let isAllowed = this._parsePermission(permission,null,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}
							method_options.handle(obj,req,res);
						});
					}else{ // auto handler

						let sqlQuery = this.generateSqlQuery("create",table_name,sqlTableData[table_name]);

						this.endpoint(`create_${table_name}`,variables,(obj,req,res) => {
							// despite id being null, this can still be usedful in the case where
							// permission is a function
							let isAllowed = this._parsePermission(permission,null,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}

							for(let generatedField in autoGeneratedVariables){
								obj[table_name+"_"+generatedField] = autoGeneratedVariables[generatedField](obj,req,res);
							}


							// check that the variables representing ids point to valid objects.
							for(let foreign_var in foreign_id_variables){
								let id = obj[foreign_var];
								let isValid = this.isDatabaseIdValid(foreign_id_variables[foreign_var],id)
								if(!isValid){
									sendError(res,`Invalid id provided for ${foreign_var}`);
									return;
								}
							}

							let valuesList = [];
							console.log("Insert field order:");
							for(let field in sqlTableData[table_name]){
								console.log(field);
								if(field === "id") continue;
								let finfo = sqlTableData[table_name][field];
								if(finfo.foreign !== undefined){
									let referenced_table = this.table_info[finfo.foreign];
									if(referenced_table.isuser){
										valuesList.push(obj.user_id);
									}else{
										valuesList.push(obj[`${finfo.foreign}_id`]);
									}
								}else{
									// convert date to ISO if needed:
									let o = obj[table_name+"_"+field];
									if(o instanceof Date){
										o = o.toISOString();
									}
									valuesList.push(o);
								}
							}

							try{
								let result = this.sql._run.apply(null,[sqlQuery,...valuesList]);
								sendSucess(res,result.lastInsertRowid);
								return;
							}catch(err){
								consoleError(`Bad SQL request from create_${table_name}: ${sqlQuery}`);
								console.log(err.message);
								console.log(valuesList);
							}
							sendError(res,"not ok");

						},`Create a new element inside ${table_name}`);
						this.routes[`create_${table_name}`].sqlQuery = sqlQuery;
					}
					this.routes[`create_${table_name}`].auto = true;
					this.routes[`create_${table_name}`].permission = permission;

				}else if(method_name === "remove"){
					// endpoint to remove an element in this table.
					// we just need the id of the element to remove it.

					// TODO: However, this can get awkward for object with private ids.
					// For example, likes don't have ids, a user should be able
					// to specify it's own id and the id of a post to remove a like on said post.
					// To allow for this, you can provide inside arguments any arguments you like
					// and we will remove the arguments matching those. (by default only id is required)
					// if the argument requested references the user id, it's automaticaly imported.
					// Also, permissions.

					let variables = {
						id: {type: "integer"}
					};
					let permission = method_options.permission || "all";

					if(method_options.handle !== "auto" && method_options.handle !== undefined){
						let args = method_options.variables || variables;	
						if(typeof permission === "object"){
							variables["user_id"] = {type:"integer",provider:"session"};
						}

						this.endpoint("remove_" + table_name,args,(obj,req,res) => {
							// obj.id might be undefined here. This does not matter.
							let isAllowed = this._parsePermission(permission,obj.id,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}
							method_options.handle(obj,req,res)
						},`Remove an element from ${table_name}`);
						this.routes[`remove_${table_name}`].permission = permission;
						this.routes[`remove_${table_name}`].auto = true;
					}else{
						if(permission !== "none"){
							let sqlQuery = this.generateSqlQuery("remove",table_name,sqlTableData);

							if(typeof permission === "object"){
								variables["user_id"] = {type:"integer",provider:"session"};
							}

							this.endpoint("remove_" + table_name,variables,(obj,req,res) => {
								let id = obj.id;
								let isAllowed = this._parsePermission(permission,id,table_name,req,obj);
								if(!isAllowed){
									sendError(res,"Unauthorized");
									return;
								}
								// this is only reached if the id is valid (handled by parsePermission)
								try{
									this.sql._run(sqlQuery,id);
									sendSucess(res,"ok");
									return;
								}catch(err){
									consoleError(`Bad SQL request from create_${table_name}: ${sqlQuery}`);
									console.log(err.message);
								}
								sendError(res,"not ok");
							},`Remove the element from ${table_name} with the id provided.`);
							this.routes[`remove_${table_name}`].sqlQuery = sqlQuery;
							this.routes[`remove_${table_name}`].auto = true;
							this.routes[`remove_${table_name}`].permission = permission;
						}
					}

				}else if(method_name.startsWith("list")){
					/*
					You can have multiple methods that list stuff.
					They just need to start with list but they can have different names:

					list_by_user_${tablename} vs list_${tablename} => list the ${tablename} of a user vs list any ${tablename} 

					method_options for list:

					- at: [field1,field2, ...]
					For every element in "at", add an argument to the query to only list
					elements where the field value matches exactly the value provided.
					This can be usedful if you need to list all the posts somebody made (at:["author_id"])

					- sort: "field_name"
					Used to sort the results of the list.
					If sort is an array, an argument will be added to the endpoint to choose the sort type.
					
					- search: "field_name"
					Used to search for elements where field_name is similar to the query provided.
					*/
					let variables = {};
					let description = `Return a list of ${table_name} elements`; 

					if(method_options.sort !== undefined){
						let sortField = method_options.sort;
						// check if sortField is valid
						if(sqlTableData[table_name][sortField] === undefined){
							consoleError(`Unable to create ${method_name}_${table_name} endpoint, the "sort" field ${sortField} is not a valid field.`);
							continue;
						}
						description += ` sorted by ${sortField}`;
					}

					if(method_options.search !== undefined){
						let searchField = method_options.search;
						if(sqlTableData[table_name][searchField] === undefined){
							consoleError(`Unable to create ${method_name}_${table_name} endpoint, the "search" field ${searchField} is not a valid field.`);
							continue;
						}
						if(sqlTableData[table_name][searchField].type !== "TEXT"){
							consoleError(`Unable to create ${method_name}_${table_name} endpoint, the "search" field ${searchField} is not of type string`);
							continue;
						}
						variables[`search`] = {type: "string"};
						description += ` whose ${searchField} is similar to the search field.`;
					}

					let isAtValid = true;
					method_options.at = method_options.at || [];
					for(let i = 0;i < method_options.at.length;i++){
						let fieldName = method_options.at[i];
						if(sqlTableData[table_name][fieldName] === undefined){
							consoleError(`Unable to create list_${table_name} endpoint, the "at" field ${fieldName} is not a valid field.`);
							isAtValid = false;
							break;
						}
						if(sqlTableData[table_name][fieldName].foreign){
							variables[`${table_name}_${fieldName}`] = {type:"integer"};
						}else{
							let ftype = this.table_info[table_name].fields[fieldName].type;
							variables[`${table_name}_${fieldName}`] = {type:ftype};
						}
					}
					if(!isAtValid){
						continue;
					}

					let permission = method_options.permission || "all";


					if(method_options.handle !== "auto" && method_options.handle !== undefined){
						let args = method_options.variables || variables;
						this.endpoint(`${method_name}_${table_name}`,variables,(obj,req,res) => {
							let isAllowed = this._parsePermission(permission,null,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}
							method_options.handle(obj,req,res);
						},`Return a list of ${table_name} elements`);
						// we don't provide a more accurate description here as this handle could
						// do anything in theory which might lead to highly missleading description
					}else{
						let sqlQuery = this.generateSqlQuery(method_name,table_name,method_options);

						this.endpoint(`${method_name}_${table_name}`,variables,(obj,req,res) => {
							let isAllowed = this._parsePermission(permission,null,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}
							
							let values = [];
							if(method_options.search){
								values.push('%'+obj["search"]+'%');
							}
							for(let i = 0;i < method_options.at.length;i++){
								values.push(obj[`${table_name}_${method_options.at[i]}`]);
							}

							let result = this.sql._get_all.apply(null,[sqlQuery,...values]);
							sendSucess(res,result);
						},description);
						this.routes[`${method_name}_${table_name}`].sqlQuery = sqlQuery;
					}
					this.routes[`${method_name}_${table_name}`].auto = true;
					this.routes[`${method_name}_${table_name}`].permission = permission;
				}else if(method_name.startsWith("count")){
					// similar to list but we return the number of elements matching the query rather than
					// the elements themselves.

					let variables = {};
					if(method_options.sort !== undefined){
						let sortField = method_options.sort;
						// check if sortField is valid
						if(sqlTableData[table_name][sortField] === undefined){
							consoleError(`Unable to create ${method_name}_${table_name} endpoint, the "sort" field ${sortField} is not a valid field.`);
							continue;
						}
					}
					if(method_options.search !== undefined){
						let searchField = method_options.search;
						if(sqlTableData[table_name][searchField] === undefined){
							consoleError(`Unable to create ${method_name}_${table_name} endpoint, the "search" field ${searchField} is not a valid field.`);
							continue;
						}
						if(sqlTableData[table_name][searchField].type !== "TEXT"){
							consoleError(`Unable to create ${method_name}_${table_name} endpoint, the "search" field ${searchField} is not of type string`);
							continue;
						}
						variables[`search`] = {type: "string"};
					}

					let isAtValid = true;
					method_options.at = method_options.at || [];
					for(let i = 0;i < method_options.at.length;i++){
						let fieldName = method_options.at[i];
						if(sqlTableData[table_name][fieldName] === undefined){
							consoleError(`Unable to create list_${table_name} endpoint, the "at" field ${fieldName} is not a valid field.`);
							isAtValid = false;
							break;
						}
						if(sqlTableData[table_name][fieldName].foreign){
							variables[`${table_name}_${fieldName}`] = {type:"integer"};
						}else{
							let ftype = this.table_info[table_name].fields[fieldName].type;
							variables[`${table_name}_${fieldName}`] = {type:ftype};
						}						
					}
					if(!isAtValid){
						continue;
					}

					let permission = method_options.permission || "all";
					if(method_options.handle !== "auto" && method_options.handle !== undefined){
						let args = method_options.variables || variables;
						this.endpoint(`${method_name}_${table_name}`,variables,(obj,req,res) => {
							let isAllowed = this._parsePermission(permission,null,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}
							method_options.handle(obj,req,res);
						});
					}else{
						let sqlQuery = this.generateSqlQuery(method_name,table_name,method_options);

						this.endpoint(`${method_name}_${table_name}`,variables,(obj,req,res) => {
							let isAllowed = this._parsePermission(permission,id,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}
							// we add the 1=1 so that there are no complex condition to check to know if AND should be added.
							let values = [];
							if(method_options.search){
								values.push('%'+obj["search"]+'%');
							}
							for(let i = 0;i < method_options.at.length;i++){
								values.push(obj[`${table_name}_${fieldName}`]);
							}

							let result = this.sql._get_all.apply(null,[sqlQuery,...values]);
							sendSucess(res,result);
						});
						this.routes[`${method_name}_${table_name}`].sqlQuery = sqlQuery;
					}
					this.routes[`${method_name}_${table_name}`].auto = true;
					this.routes[`${method_name}_${table_name}`].permission = permission;
				}else{
					// do auto handler here, but we help the user create it's own thing
					// might be useful if the user wants to fetch multiple fields at once for example
					// it's similar to just using endpoint but it informs the reader of the code
					// that this endpoint is related to the current table.
					if(typeof method_name.handle !== "function"){
						consoleError(`Inside the table ${table_name}:\nYou did not provide a valid handle for the endpoint ${method_name}_${table_name} that you are trying to create.\nYou might have misspelled ${method_name} ?`);
					}else{
						let permission = method_options.permission || "all";
						let variables = method_options.variables || {};

						if(typeof permission === "object"){
							variables["user_id"] = {type:"integer",provider:"session"};
						}

						this.endpoint(`${method_name}_${table_name}`,variables,(obj,req,res) => {
							let isAllowed = this._parsePermission(permission,null,table_name,req,obj);
							if(!isAllowed){
								sendError(res,"Unauthorized");
								return;
							}

							method_name.handle(obj,req,res);
						});
						// This is still considered "auto"
						this.routes[`${method_name}_${table_name}`].auto = true;
						this.routes[`${method_name}_${table_name}`].permission = permission;
					}
				}
			}

		}

		let jsString = jsgen(this);
		this.js_interface_string = jsString;
		let docString = docgen(this);
		if(this.doc){ // no need to waste RAM for this in non debug mode.
			this.debug_template = docString;
		}
		fs.writeFileSync('doc.html',docString,{flag:'w+'});

		this.compiled = true;
	} // end of compile


	// example: generateSqlQuery("list","user",{}) => SELECT id FROM user
	generateSqlQuery(endpoint_type,table_name,endpoint_options){
		if(endpoint_type === "create"){

			let sqlRequest = `INSERT INTO ${table_name} `;
			// sqlRequest += "(a,b,c) VALUES (d,e,f);";
			let fieldList = [];
			for(let field in endpoint_options){
				if(field === "id") continue;
				fieldList.push(field);
			}
			sqlRequest += `(${fieldList.join(',')}) VALUES `;
			let questionMarkList = [];
			for(let field in endpoint_options){
				if(field === "id") continue;
				questionMarkList.push("?");
			}
			sqlRequest += `(${questionMarkList.join(',')})`; // += "(?,?, ..., ?)"
			return sqlRequest;
		}else if(endpoint_type === "remove"){
			return `DELETE FROM ${table_name} WHERE id = ?`;
		}else if(endpoint_type.startsWith("list")){
			// we add the 1=1 so that there are no complex condition to check to know if AND should be added.
			let sqlRequest = `SELECT ${this.table_info[table_name].defaultSelector} FROM ${table_name} ${this.table_info[table_name].joinOnDefault} WHERE 1=1 `;

			if(typeof endpoint_options.search === "string"){
				sqlRequest += `AND ${table_name}.${endpoint_options.search} LIKE ? `;
			}
			if(typeof endpoint_options.filter === "string"){
				sqlRequest += `AND ${endpoint_options.filter} `;
			}

			for(let i = 0;i < endpoint_options.at.length;i++){
				let fieldName = endpoint_options.at[i];
				sqlRequest += `AND ${fieldName} = ? `;
			}

			if(endpoint_options.sort){
				sqlRequest += `ORDER BY ${endpoint_options.sort} DESC `;
			}
			if(endpoint_options.limit){
				sqlRequest += `LIMIT `+endpoint_options.limit;
			}

			return sqlRequest;
		}else if(endpoint_type.startsWith("count")){
			let sqlRequest = `SELECT COUNT(*) FROM ${table_name} WHERE 1=1 `;
			if(typeof endpoint_options.search === "string"){
				sqlRequest += `AND ${table_name}.${endpoint_options.search} LIKE ? `;
			}
			for(let i = 0;i < endpoint_options.at.length;i++){
				let fieldName = endpoint_options.at[i];
				sqlRequest += `AND ${fieldName} = ? `;
			}
			if(typeof endpoint_options.filter === "string"){
				sqlRequest += `AND ${endpoint_options.filter} `;
			}
			if(endpoint_options.sort){
				sqlRequest += `ORDER BY ${endpoint_options.sort} DESC`;
			}
			return sqlRequest;
		}

		consoleError("Bad endpoint type, cannot provide SQL.");
		return "";
	}

	__call__(req,res,next){
		if(!this.compiled){
			this.compile();
		}
		middleware(this,req,res,next);
	}

	sendSuccess(res,object){
		return sendSucess(res,object);
	}


	sendError(res,object){
		return sendError(res,object);
	}

	redirect(res,path){
		res.writeHead(302,{
			Location: path
		});
		res.end();
	}
	listen(){
		let server = http.createServer(this);
		return server.listen.apply(server, arguments);
	}
}

module.exports = VBel;