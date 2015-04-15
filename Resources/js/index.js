var exec = require('child_process').exec;
var fs = require('fs');
var gui = require('nw.gui');
var os = require('os');
var path = require('path');
var request = require('request');

var Settings = require('./js/settings');
var Services = require('./js/services');

process.on('uncaughtException', function(err) {
    console.log('Caught exception: ', err);
    window.alert('There was an uncaught exception.' + err);
    gui.Window.get().showDevTools();
});

function Pussh() {
    this.settings = new Settings();
    this.platform = os.platform();
    this.name = gui.App.manifest.name;
    this.version = gui.App.manifest.version;
    this.window = gui.Window.get();
    this.tink = new Audio('aud/ts-tink.ogg');

    this.services = new Services(this);

    this._settingsWindow = null;

    this.watch();
    this.launchAtStartup();
    this.setupTray();
    this.buildTrayMenu(false);
    this.firstLaunch();
    this.checkUpdates();

    gui.Screen.Init();

    var _self = this;

    gui.App.on('reopen', function() {
        _self.showSettingsWindow();
    });
}

Pussh.prototype.firstLaunch = function() {
    var _self = this;

    if (_self.settings.get('lastVersionLaunched') != _self.version) {
        _self.showSettingsWindow();

        _self.settings.set('lastVersionLaunched', _self.version)
    }
}

Pussh.prototype.checkUpdates = function() {
    var _self = this;

    if (!_self.settings.get('checkForUpdates')) return;

    request('http://pussh.me/dl/pussh.json', function(error, response, body) {
        if (!error && response.statusCode === 200) {
            var data = JSON.parse(body);

            if (!data.version) return;

            if (_self.version != data.version) {

                var msg = 'Pussh has an available update. Click "OK" to open the Pussh download page...';
                if (confirm(msg)) {
                    gui.Shell.openExternal('http://pussh.me/');
                }
            }
        }
    });
}

Pussh.prototype.showSettingsWindow = function() {
    var _self = this;

    try {// it's just sooo much easier to try catch, then try and manage the window :P
        _self._settingsWindow.focus();
    } catch (err) {
        _self._settingsWindow = gui.Window.open('settings-window.html', {
            "focus": true,
            "toolbar": false,
            "width": 900,
            "height": 550
        });
    }
}

Pussh.prototype.setupTray = function() {
    // create status item
    this.tray = new gui.Tray({
        icon: path.join(process.cwd(), 'Resources', 'img', 'menu-icon@2x.png'),
        alticon: path.join(process.cwd(), 'Resources', 'img', 'menu-alt-icon@2x.png'),
        iconsAreTemplates: true
    });

    var nativeMenuBar = new gui.Menu({ type: "menubar" });
    if (this.platform === 'darwin') {
        nativeMenuBar.createMacBuiltin(this.name);
    }
    this.window.menu = nativeMenuBar;
}

Pussh.prototype.setTrayState = function(state) {
    var _self = this;

    if(state === 'off') {
        _self.tray.iconsAreTemplates = true;
        _self.tray.icon = path.join(process.cwd(), 'Resources', 'img', 'menu-icon@2x.png');
    } else if (state === 'active') {
        _self.tray.iconsAreTemplates = false;
        _self.tray.icon = path.join(process.cwd(), 'Resources', 'img', 'menu-active-icon@2x.png');
    } else if (state === 'complete') {
        _self.tray.iconsAreTemplates = false;
        _self.tray.icon = path.join(process.cwd(), 'Resources', 'img', 'menu-done-icon@2x.png');
    }
}

Pussh.prototype.buildTrayMenu = function(lastURL) {
    var _self = this;

    var menu = new gui.Menu();

    // add the last url
    if(lastURL) {
        menu.append(new gui.MenuItem({
            label: lastURL,
            click: function() {
                _self.copyToClipboard(lastURL);
                gui.Shell.openExternal(lastURL);
            }
        }));

        // add a separator
        menu.append(new gui.MenuItem({
            type: 'separator'
        }));
    }

    // Take a cropped screenshot
    menu.append(new gui.MenuItem({
        label: 'Cropped Capture',
        click: function() {
            if (this.platform === 'darwin') exec('osascript -e \'tell application "System Events" to keystroke "$" using {command down, shift down}\'');
            if (this.platform === 'win32') _self.windowsCapture(true);
        }
    }));

    // Take a fullscreen screenshot
    menu.append(new gui.MenuItem({
        label: 'Screen Capture',
        click: function() {
            if (this.platform === 'darwin') exec('osascript -e \'tell application "System Events" to keystroke "#" using {command down, shift down}\'');
            if (this.platform === 'win32') _self.windowsCapture(false);
        }
    }));
        
    // open settings
    menu.append(new gui.MenuItem({
        label: 'Settings',
        click: function() {
            _self.showSettingsWindow();
        }
    }));

    // quit app
    menu.append(new gui.MenuItem({
        label: 'Quit '+this.name,
        click: function() {
            gui.App.quit();
        }
    }));

    _self.tray.menu = menu;
}

Pussh.prototype.watch = function() {
    var _self = this;

    if (this.platform == 'darwin') {
        var desktopFolder = path.join(process.env['HOME'], 'Desktop');

        var checkedFiles = [];
        setInterval(function() {
            fs.readdir(desktopFolder, function(err, files) {
                if(!err && files.length) {
                    var filteredFiles = files.filter(function(file) {
                        return (checkedFiles.indexOf(file) === -1 && /.png$/.test(file)) ? true : false;
                    });

                    filteredFiles.forEach(function(file) {
                        filePath = path.join(desktopFolder, file);

                        var fStats = fs.statSync(filePath);

                        if(Date.now()-fStats.ctime.getTime() > 3000) return;

                        exec('/usr/bin/mdls --raw --name kMDItemIsScreenCapture "'+filePath+'"', function(error, stdout) {
                            if(error) return;

                            // 1 = screenshot, 0 = not a screenshot
                            if(!parseInt(stdout)) {
                                checkedFiles.splice(checkedFiles.indexOf(file), 1);
                                return;
                            }

                            console.log('Uploading %s', filePath);

                            var newFile = _self.moveToTemp(filePath);

                            _self.upload(newFile, filePath);
                        });
                    });

                    checkedFiles = files;
                }
            });
        }, 1000);
    } else if (this.platform == 'win32') {
        var windowsFullScreenshot = new gui.Shortcut({
            key: "Alt+Shift+3",
            active: function() {
                _self.windowsCapture(false);
            }
        });

        var windowsCropScreenshot = new gui.Shortcut({
            key: "Alt+Shift+4",
            active: function() {
                _self.windowsCapture(true);
            }
        });

        gui.App.registerGlobalHotKey(windowsFullScreenshot);
        gui.App.registerGlobalHotKey(windowsCropScreenshot);
    }
}

Pussh.prototype.windowsCapture = function(needsCrop) {
    var _self = this;

    if (this.platform == 'win32') {

        // setup files
        var basePath = process.env['TEMP'];
        var fullImg = path.join(basePath, 'pussh_screen.png');
        var cropImg = path.join(basePath, 'pussh_screen_crop.png');

        // take the screenshot and start crop if needed
        exec(path.join(process.cwd(), 'Resources', 'exe', 'PusshCap.exe') + ' ' + fullImg, function(error, stdout) {
            if (error) return;

            var theScreen = [0,0,100,100,0,0,"cap.png"];
            if (stdout) {
                theScreen = stdout.split(',');
            }

            if (!needsCrop) {
                _self.upload(fullImg);
            } else {
                var cropWindow = gui.Window.open('windows-crop.html', {
                    "toolbar": false,
                    "width": 0,
                    "height": 0,
                    "x": parseInt(theScreen[4]),
                    "y": parseInt(theScreen[5]),
                    "show": false
                });

                cropWindow.on('closed', function() {
                    if (fs.existsSync(cropImg)) {
                        _self.deleteFile(fullImg);
                        _self.upload(cropImg);
                    }
                });

                cropWindow.on('blur', function() {
                    cropWindow.close(true);
                });
            }
        });

    }
}

Pussh.prototype.launchAtStartup = function() {
    if(this.settings.get('launchAtStartup') === true) {
        switch(this.platform) {
            case 'win32':
                // TODO
                break;
            case 'darwin':
                var pathToExecutable = path.join(process.execPath, '../../../../../../').replace(/\/$/, '');
                exec('osascript -e \'tell application "System Events" to make login item at end with properties {path:"'+pathToExecutable+'", hidden:false}\'');
                break;
            case 'linux':
                // TODO
                break;
            default:
                return;
        }
    } else {
        switch(this.platform) {
            case 'win32':
                // TODO
                break;
            case 'darwin':
                exec('osascript -e \'tell application "System Events" to delete login item "'+this.name+'"\'');
                break;
            case 'linux':
                // TODO
                break;
            default:
                return;
        }
    }
}

// Uploads a new file
// TODO: Tray icon status change to uploading
Pussh.prototype.upload = function(file, oldFile) {
    var _self = this;

    var selectedService = _self.settings.get('selectedService');

    file = this.randomizeFilename(file);
    file = this.prefixFilename(file);

    if(_self.settings.get('enableNotifications')) {
        new window.Notification('Pussh', {
            body: 'Pussh has initiated a screenshot upload.',
            icon: _self.platform !== 'darwin' ? path.join(process.cwd(), 'Resources', 'img', 'icon.png') : undefined
        });
    }

    // set status icon to active
    _self.setTrayState('active');

    this.resize(file, function() {
        _self.services.get(selectedService).upload(file, function(url) {
            if (oldFile) _self.trash(oldFile);
            _self.deleteFile(file);
            _self.copyToClipboard(url);
            
            if(_self.settings.get('audioNotifications')) {
                _self.tink.load();
                _self.tink.play();
            }

            if(_self.settings.get('openBrowser')) {
                gui.Shell.openExternal(url);
            }

            // set status icon to 'complete' for 3 seconds
            _self.setTrayState('complete');
            setTimeout(function() {
                _self.setTrayState('off');
            }, 3000);

            _self.buildTrayMenu(url);
        });
    });
}

Pussh.prototype.moveToTemp = function(file) {
    var tmpFile;

    switch(this.platform) {
        case 'win32':
            tmpFile = path.join(process.env['TEMP'], path.basename(file));
            break;
        case 'darwin':
            tmpFile = path.join(process.env['TMPDIR'], path.basename(file));
            break;
        case 'linux':
            tmpFile = path.join('/tmp', path.basename(file));
            break;
        default:
            return;
    }

    fs.writeFileSync(tmpFile, fs.readFileSync(file));
    return tmpFile;
}

// Trash file after upload
Pussh.prototype.trash = function(file) {
    var _self = this;

    if(_self.settings.get('sendToTrash') === false) return;

    var trashFolder;

    switch(_self.platform) {
        case 'win32':
            // this does not work
            trashFolder = path.join(process.env['SystemRoot'], '$Recycle.bin', process.env['SID']);
            break;
        case 'darwin':
            trashFolder = path.join(process.env['HOME'], '.Trash');
            break;
        case 'linux':
            trashFolder = path.join(process.env['HOME'], '.local', 'share', 'Trash');
            break;
        default:
            return;
    }

    // We could just delete the file, but what if the user wants it back
    fs.rename(file, path.join(trashFolder, path.basename(file)));
}

Pussh.prototype.deleteFile = function(file) {
    fs.unlinkSync(file);
}

Pussh.prototype.randomizeFilename = function(file) {
    if(this.settings.get('randomizeFilenames') === false) return file;

    var characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    var newName = "";

    for(var i=0; i < this.settings.get('randomizeFilenamesLength'); i++) {
        newName += characters.charAt(Math.floor(Math.random()*characters.length));
    }

    newName += path.extname(file); // Append file extension

    var newFile = path.join(path.dirname(file), newName);
    fs.renameSync(file, newFile);
    return newFile;
}

Pussh.prototype.prefixFilename = function(file) {
    if(!this.settings.get('prefixFilenames').length) return file;

    var newName = this.settings.get('prefixFilenames')+path.basename(file);

    var newFile = path.join(path.dirname(file), newName);
    fs.renameSync(file, newFile);
    return newFile;
}

// Retina screens cause issues, so we give the option to resize
Pussh.prototype.resize = function(file, callback) {
    var _self = this;

    if(_self.platform !== 'darwin' || _self.settings.get('retinaResize') === false) return callback();

    exec('/usr/bin/sips -g dpiWidth -g pixelWidth "'+file+'"', function(error, stdout) {
        if(error) return callback();

        var lines = stdout.split('\n');

        var dpiWidth = parseFloat(lines[1].split(':')[1].trim());
        var pixelWidth = parseInt(lines[2].split(':')[1].trim());

        if(parseInt(dpiWidth) === 72) return callback();

        var newWidth = Math.round((72 / dpiWidth) * pixelWidth);

        exec('/usr/bin/sips --resampleWidth '+newWidth+' "'+file+'"', function(error, stdout) {
            callback();
        });
    });
}

// Copy url to clipboard after upload
Pussh.prototype.copyToClipboard = function(url) {
    var _self = this;

    var clipboard = gui.Clipboard.get();
    clipboard.set(url);

    if (_self.settings.get('enableNotifications')) {
        var notification = new window.Notification('Pussh', {
            body: 'The screenshot URL has been copied to your clipboard.',
            icon: _self.platform !== 'darwin' ? path.join(process.cwd(), 'Resources', 'img', 'icon.png') : undefined
        });

        notification.addEventListener('click', function() {
            gui.Shell.openExternal(url);
        });
    }
}

global.Pussh = new Pussh();
