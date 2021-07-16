# VBel2

VBel2 helps you quickly build complex APIs that easily integrate with your frontend.

## Overview

VBel2 stands for Vanyle's BackEnd Library 2. It is a framework to build backends in NodeJS. VBel2 allows you to quickly build complex websites with minimal effort for your backend. 

Most website are just an interface between a user and a database. The only job of the backend is to make sure that the users have proper authorizations to read or edit the database. It's from this observation that VBel2 was built.

With VBel2, you just describe what your database looks like, things like:

- Your tables
- The fields in those tables
- The relationships between the fields
- The permissions required to read or edit the fields

And VBel2 will automatically create the database with the layout provided, create all the endpoints needed to do the actions you specified and generate all the documentation needed to use those endpoints. VBel2 will also generate some JavaScript for your client so that the client can call these backend functions without having to think.

It's as if the client can simply call function or access variables that exist server-side as long as the types of the arguments are correct and that the client has sufficient authorizations.

Of course, VBel2 also allows you to also create your own endpoints, if you want to do more than reading or writing data.

You can easily integrate VBel2 into any existing application as you can use as many or as little of VBel2's features as you need. VBel2 acts just as any `express` middleware, so you can just add `app.use(vbel)` to your app and you're ready to go. You can also use VBel2 without express, just call `vbel(req,res,callback)` and VBel2 will try to handle the request and call `callback` if the request was not meant for VBel2 (in the case of a 404 for example)

## Using VBel2 to create endpoints

Let's say you have a nodejs application built with express and you want to add a new endpoint.
For example, an endpoint that returns a random number from the server. 

You could write something like this:
```js
let app = express();

// Setup app here ... serve static file or something ...

let vbel = new VBel();
vbel.endpoint(
    "rnd_number", // name of the endpoint
    {
        min:{type:"number"}, // variables of the endpoint
        max:{type:"number"};
    },
    (obj,req,res) => {
        // behavior of the endpoint
        // VBel does all the typechecking for you.
        let nbr = Math.random() * (obj.max - obj.min) + obj.min;
        vbel.sendResult(res,nbr);
    }
);

app.use(vbel);

app.listen(8080);

```

And on the client size, you can have:
```html
<html>
    ... Your page
    <script src="/client.js"></script> <!-- script generated by VBel to access your endpoints -->
    <script>
        async function main(){
            let nbr = await rnd_number(0,100); // call the endpoint defined previously.
            console.log(nbr.result) // => access the result.
            let badType = await rnd_number("hello","world");
            console.log(nbr.error); // => notice that proper typing is required.
        }
        main();
    </script>
</html>
```


## Using VBel2 to manage SQL tables

Sometime, you need more than just calling server side functions from the client,
you need to access some SQL tables.

Well, VBel2 got you covered. You can define an SQL scheme inside your javascript and
VBel2 will generate all the endpoints needed to use the scheme you defined.

VBel2 will make all the necessery checks and SQL requests so that everything works.

```js

// Use the SQL Database you want !
// I use better-sqlite3 in this example but any other database works too.
const sqlite3 = require('better-sqlite3');

let db = sqlite3("./mydb.db",{});

let config = {
    // You define the SQL functions that VBel will use.
    sql:{
        _run: (statement,...args) => {
            let s = db.prepare(statement);
            return s.run.apply(s,args);
        },
        _get_all:(statement, ...args) => {
            let s = db.prepare(statement);
            return s.all.apply(s,args);
        },
    },
    // Don't generate documentation in production !
    doc: true
}

let vbel = new VBel(config);

vbel.table("user",{
    isuser:true, // the table describes a connected client
    fields:{
        name:{
        	read:"all",
        	write:"none"
        	// read:all and write:none and the default
    	},
    	birth:{
            type:"date",
            read:{"match":"id"} // only a client with the matching user id can read this.
            // aka nobody except the current client.
            write: (userid,currentObject) => { // custom function returning a bool if you need more control
        		// userid is the id of the connected client making the request. It's null if the client is not logged in.
        		// currentObject is a JS object containing the fields of the object we are trying to access.
        		return areFriends(userid,currentObject.id);
		   }
        },
        posts:{
            type:"foreign", // References the table "post"
            bind:"post",
            bind_field:"author_id", // generate a author_id field in post
            // because foreign fields represents "arrays" more or less,
            // they have no write function.
            // Instead, you should use the create and remove methods of the corresponding table.
        },
        rank:{
            type:"integer",
            write: isAdmin
        }
    },
    methods:{
        create:{}, // generate a handle to create a client
        remove:{
            handle: () => {
                // specify a custom function that will remove a client
                // useful if you need to do more than just an SQL DELETE call.
            }
        }, // generate a handle to remove a client
        list:{
            permission:"all" // specify permission for this endpoint. This has the same format as read / write
        } // generate a handle to list all clients
    }
});

```

A other example of a custom access function:
```js

function isAdmin(userid){
    // the currentObject argument is omitted because it's not needed
    // The write permission is granted if the caller is an admin, no matter the user changed.
    let r = vbel.getDatabaseValue("user",userid,"rank");
    // getDatabaseValue returns an array
    // The array is empty if no matches are found and might contain more elements
    // The array contains objects that have the fields you asked for, in this case, only a rank field
    if(r.length !== 1) return false;
    return r[0].rank === RANKS.ADMIN;
}

```


## Default Selectors and joinOnDefault

When creating an SQL table, you can define a `defaultSelector` to make fetching informations
about the objects in the table more convenient. You can also use `joinOnDefault` if the information
you want to fetch are in another table.

```js
vw.table("post",{
    defaultSelector:"post.id,title,user.name AS author,date,SUBSTR(content,0,80) AS preview",
    joinOnDefault:"JOIN user ON user.id = author_id", // Used to also fetch the name of the author.
    // Some fields ...
    fields:{
        title:{},
        content:{},
        date:{type:"date"},
        methods:{
            create:{ // note that in this case, everybody can create a post
                generate:{ // autogenerate some fields
                    date: (obj,req,res) => {return new Date();}
                }
            },
            remove:{
                permission:isAllowedToRemove
            },
            // You can have multiple list methods for different search types
            // Remember that you can add permissions to these if you want.
            list_by_title:{
                search:"title", // create a new search field in the request
                filter:"date > '1/21/2012'", // add a filter if needed
                limit:15 // max number of returned results
            },
            list_by_date:{
                sort:"date", // descending sort, you can use this with search too.
                filter:"date > '1/21/2012'",
                limit:15
            },
            list_by_user:{
                at:["author_id"] // list with exact match to list the posts of a specific user.
            }
        }
});
```

By default, the methods with automatic handlers are `create`, `remove`, `list` (as well as `read` and `write`)
for every other field.

You can also add other handler but you need to specify a handler function.

You can use these handler in conjunction with the other endpoints.

## Access documentation

Because VBel2 is aware of all the endpoints you create, their types and the database scheme,
VBel2 can provide you with all the documentation you need about all the endpoints.

Just do `new VBel({doc:true})` when creating the VBel object and go to `/doc` to access the documentation page.
This page will list all the endpoints available, their arguments, the permission required to use them and more !

You can also access the documentation and share it with the `doc.html` file created. 

## Tests

VBel uses jest for testing. You can find the tests inside test.js.