//# sourceURL=server/http
(function Http() {
	let async, jszip;

	//-----------------------------------------------------dispatch
	var dispatch = {
		Setup: Setup,
		Start: Start,
		GetModule: GetModule,
		'*': Publish
	};

	return {
		dispatch: dispatch
	};

	function Setup(com, fun) {
		log.v('--Http/Setup');

		async = this.require('async');
		jszip = this.require("jszip");

		if (fun)
			fun();
	}

	function Start(com, fun) {
		log.v('--Http/Start');
		var that = this;
		var http = this.require('http');
		var sockio = this.require('socket.io');
		var port;
		var Par = this.Par;
		var Vlt = this.Vlt;
		Vlt.Session = this.genPid();
		if ('Port' in this.Par)
			port = this.Par.Port;
		else
			port = 8080;
		var web = http.createServer(function (req, res) {
			//	console.log(req.method + ':' + req.url);
			switch (req.method) {
				case 'POST':
					break;
				case 'GET':
					Get(that, req, res);
					break;
			}
		});
		web.listen(port);
		webSocket(web);
		console.log(' ** Spider listening on port', port);
		if ('Config' in this.Par) {
			readBrowser(null, this.Par.Config);
		} else {
			readBrowser('Config not in Par', null);
		}

		function readBrowser(err, data) {
			if (err) {
				console.log(' ** ERR::Cannot read browser config');
				fun(err);
				return;
			}
			Vlt.Browser = JSON.parse(data.toString());
			getscripts();
		}

		function getscripts() {
			that.getFile('scripts.json', function (err, data) {
				if (err) {
					console.log(' ** ERR:Cannot read script.json');
					fun(err);
					return;
				}
				Vlt.Browser.Scripts = JSON.parse(data.toString());
				getnxs();
			})
		}

		function getnxs() {

			that.getFile('Nxs.js', function (err, data) {
				if (err) {
					console.log(' ** ERR:Cannot read Nxs file');
					return;
				}
				Vlt.Browser.Nxs = data.toString();
				fun();
			});
		}

		//---------------------------------------------------------webSocket
		function webSocket(web) {
			var listener = sockio.listen(web);
			Vlt.Sockets = {};
			var Sockets = Vlt.Sockets;

			listener.sockets.on('connection', function (socket) {
				// console.log('sock/connection');
				var pidsock = '';
				for (var i = 0; i < 3; i++)
					pidsock += that.genPid().substr(24);
				var obj = {};
				obj.Socket = socket;
				obj.User = {};
				obj.User.Pid = '160D25754C01438388CE6A946CD4480C';
				Sockets[pidsock] = obj;

				var cfg = Vlt.Browser;
				cfg.Pid24 = pidsock;
				cfg.PidServer = Par.Pid;
				cfg.ApexList = Par.ApexList || {};
				var str = JSON.stringify(cfg);
				socket.send(str);

				socket.on('disconnect', function () {
					// console.log(' >> Socket', pidsock, 'disconnected');
					delete Sockets[pidsock];
				});

				socket.on('error', function (err) {
					// console.log(' >> Socket', pidsock, '**ERR:' + err);
					delete Sockets[pidsock];
				});

				socket.on('message', function (msg) {
					//debugger;
					var com = JSON.parse(msg);
					//console.log('>>Msg:' + JSON.stringify(com));
					if (!com) {
						console.log(' ** onMessage: Invalid message');
						return;
					}
					if (com.Cmd == 'GetFile') {
						getfile();
						return;
					}
					if (com.Cmd == 'Subscribe') {
						obj.User.Publish = com.Pid;
						return;
					}
					if (!('Passport' in com)) {
						console.log(' ** ERR:No Passport in routed msg');
						return;
					}

					// debugger;
					//	com.Passport.User = obj.User;
					if ('Reply' in com.Passport && com.Passport.Reply) {
						// debugger;
						if (com.Passport.Pid in that.Vlt.messages) {
							that.Vlt.messages[com.Passport.Pid](null, com);
							delete that.Vlt.messages[com.Passport.Pid];
						}
						return;
					}
					//debugger;
					that.send(com, com.Passport.To, reply);

					function reply(err, cmd) {
						// console.log("--HttpReply");
						// console.log(JSON.stringify(cmd));
						// console.log(JSON.stringify(com));
						if (cmd) {
							com = cmd;
						}
						com.Passport.Reply = true;
						var str = JSON.stringify(com);
						socket.send(str);
					}

					//.....................................getfile
					/// Read file from local directory
					function getfile() {
						//debugger;
						var path = com.File;
						that.getFile(path, function (err, data) {
							if (err) {
								console.log(' ** ERR', err);
								return;
							}
							com.Data = data.toString('utf8');
							var str = com.Data;
							if ('Passport' in com)
								com.Passport.Reply = true;
							var str = JSON.stringify(com);
							socket.send(str);
						});
					}
				});
			});
		}
	}

	//-------------------------------------------------------Publish
	// This is called when message needs to be sent to all
	// browsers that have subscribed
	function Publish(com, fun) {
		//debugger;
		// console.log('--Publish', com.Cmd);
		fun = fun || (() => { });
		var Vlt = this.Vlt;
		var socks = Vlt.Sockets;
		var keys = Object.keys(socks);
		for (var i = 0; i < keys.length; i++) {
			var obj = socks[keys[i]];
			var sock = obj.Socket;
			var user = obj.User;
			if ('Publish' in user) {
				com.Passport.To = user.Publish;
				if (fun) {
					com.Passport.Disp = 'Query';
				}
			}
			if ('Forward' in com) {
				com.Passport.To = com.Forward;
				if (fun) {
					if (!('messages' in this.Vlt)) this.Vlt.messages = {};
					this.Vlt.messages[com.Passport.Pid] = fun;
				}
			}
			var str = JSON.stringify(com);
			sock.send(str);
		}
	}

	//-------------------------------------------------------Get
	// Process GET request including authentication and
	// validation if required. If anything looks fishy, simply
	// ignore the request to confuse the hackers.

	//any HTTP Get accessible files should be stored in a ./static/ directory
	function Get(that, req, res) {
		log.v('--Get', req.url);
		var Par = that.Par;
		var url = req.url;
		let path = null;

		if (url.split(".").length > 1) {
			let arr = url.split('/');
			arr = arr.slice(1);

			let store = Par.Static||{};

			ship(...subSearch(arr, store));

			function subSearch(ar, st) {
				if (ar[0] in st) {
					if (ar.length == 1) {
						return [null, st[ar[0]]];
					}
					else {
						return subSearch(arr.slice(1), st[ar[0]]);
					}
				}else{
					let err = `${url} does not exist in Par.Static`;
					log.w(err);
					return [err];
				}
			}
			
		} else {
			if (url.charAt(0) == '/')
				url = url.substr(1);
			if (url==Par.Url)
				ship(null, Par.HTML);
			else{
				res.writeHead(404);
				res.end('You are out of your verbial guord');
				return;
			}
		}

		function ship(err, data) {
			if (err) {
				res.writeHead(404);
				res.end(err);
				return;
			}
			var page = data.toString();
			res.setHeader('Content-Type', 'text/html');
			res.end(page);
		}
	}

	//-----------------------------------------------------getModule
	// Retrieve module from module server
	// For now is retrieved from local file system
	function GetModule(com, fun) {
		log.v('--Http/GetModule', com.Module);
		//console.log(JSON.stringify(com));
		var that = this;
		var zip = new jszip();
		//var dir = that.genPath(com.Module);
		var man = [];
		this.getModule(com.Module, function (err, mod) {
			if (err) {
				console.log(' ** ERR:Cannot read module directory');
				if (fun)
					fun('Cannot read module directlry');
				return;
			}

			var str = JSON.stringify(mod);
			//console.log("mod is ", Object.keys(mod));
			zip.file('module.json', str, {
				date: new Date("December 25, 2007 00:00:01")
				//the date is required for zip consistency
			});
			man.push('module.json');
			zip.file('manifest.json', JSON.stringify(man), {
				date: new Date("December 25, 2007 00:00:01")
				//the date is required for zip consistency
			});
			zip.generateAsync({ type: 'base64' }).then(function (data) {
				com.Zip = data;
				fun(null, com);
			});
		});
	}

})();
