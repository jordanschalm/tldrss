/*****************************************/
/* CONSTANTS														 */
/*****************************************/

var DEFAULT_PORT = 3031;
var FEEDS_PATH = './feeds.json';

/*****************************************/
/* INITIALIZATION												 */
/*****************************************/

var fs = require('fs'),
		http = require('http'),
		express = require('express'),
		xml2js = require('xml2js'),
		request = require('request'),
		fracas = require('./package.json');

var xmlParser = new xml2js.Parser();
var xmlBuilder = new xml2js.Builder({cdata: "true"});

var app = express();
var server = http.createServer(app).listen(process.env.PORT || process.argv[2] || DEFAULT_PORT, function() {
	console.log('Fracas v' + fracas.version + ' running on port: %s', server.address().port);
}).on('error', function(err) {
	if(err.code === 'EADDRINUSE') {
		console.log('Port ' + (process.env.PORT || process.argv[2] || ALT_PORT) + ' is in use. Exiting...');
	}
});

var feeds = JSON.parse(readFileSync(FEEDS_PATH));

/*****************************************/
/* ROUTING															 */
/*****************************************/

app.get('/:feed', function(req, res) {
	var feed;
	try {
		feed = getFeed(req.params.feed)
	} catch(err) {
		send404(res, err.message);
	}
	request(feed.host, function(err, hostRes, body) {
		if(!err && hostRes.statusCode === 200) {
			applyRules(feed, body, res);
		}
	});
});

/*****************************************/
/* HELPER FUNCTIONS											 */
/*****************************************/

/*	Finds a feed object in the feeds array
 *	with the given feed ID (URL slug)
 *	feed (String)
 */
function getFeed(feed) {
	for(var i = 0; i < feeds.length; i++) {
		if(feed === feeds[i].ID) {
			return feeds[i];
		}
	}
	throw new Error('No stored feeds with ID ' + feed);
}

/*	Sends a 404 HTTP response.
 */
function send404(res, message) {
	res.writeHead(404, {"Content-type" : "text/plain"});
	res.write(("Error 404: " + message) || "Error 404: Resource not found.");
	res.end();
}

/*	Generic function to serve some data to a client.
 *
 *	data, mimeType (String)
 */
function serveData(res, data, mimeType) {
	res.writeHead(200, {"Content-type" : mimeType});
	res.end(data);
}

/*	Applies the rules for a particular feed to 
 *	that feed's XML content and serves the
 *	altered XML file to the connected client
 *	
 *	feed (Object)
 *	body (String) - unaltered XML content of the
 *									host feed
 */
function applyRules(feed, body, res) {
	xmlParser.parseString(body, function(err, result) {
		var numEpisodes = result.rss.channel[0].item.length;
		for(var index = 0; index < numEpisodes; index += Number(feed.rule)) {
			delete result.rss.channel[0].item[index];
		}
		serveData(res, xmlBuilder.buildObject(result), "text/xml");
	});
}

/*****************************************/
/* FILE I/O															 */
/*****************************************/

/*	Reads the file at the specified path, if it exists, and returns
 *	the contents of the file. This function is used for initialization
 *	when we want things to happen synchronously.
 *
 *	path (String)
 */
function readFileSync(path) {
	if(fs.existsSync(path)) {
		try {
			var data = fs.readFileSync(path);
			return data;
		} 
		catch (err) {
			throw err;
		}
	}
	else {
		throw new Error("The file at path " + path + " does not exist.");
	}
}

/*	Reads the file at the specified path, if it exists, and returns
 *	the contents of the file. This function is used after
 *	initialization is complete when we want things to happen
 *	asynchronously.
 *
 *	path (String)
 *	callback (function(err, data))
 */
function readFile(path, callback) {
	fs.exists(path, function(exists) {
		if(exists) {
			fs.readFile(path, function(err, data) {
				if(err) {
					callback(err, data);
				}
				else {
					callback(null, data);
				}
			});
		}
		else {
			callback(new Error("The file at path " + path + " does not exist."));
		}
	});
}

/*	Writes a file to disk.
 *
 *	path, data (String)
 */
function writeFile(path, data) {
	fs.open(path, 'w', function(err, fd) {
		fs.write(fd, data, function(err, written, string) {
			if(err) {
				callback(err, written, string);
			}
			else {
				callback(null, written, string);
			}
		});
	});
}