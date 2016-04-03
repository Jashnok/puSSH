var fs = require('fs');
var path = require('path');
var url = require('url');
var util = require('util');
var dialog = require('electron').dialog;

var ServiceSettings = require('../service-settings');

function Service(main) {
    this._settings = main.settings;
    Service.super_.call(this);

    this._name = "local_transfer";
    this.name = "Local Filesystem";
    this.description = "Move screenshots to a directory other then the desktop";

    this.settings = [
        {
            name: 'Location',
            key: 'location',
            type: 'text',
            password: false,
            default: '',
            helpText: 'Move new screenshots to this directory'
        }
    ];

    this.loadSettings();
}

util.inherits(Service, ServiceSettings);

Service.prototype.upload = function(file, callback) {
    var _self = this;
    if (!_self.getSetting('location')) return dialog.showMessageBox({type: 'error', buttons: ['Okay'], message: 'An error has occured :(', detail: 'No location configured'});

    var newFile = path.join(_self.getSetting('location'), path.basename(file));

    fs.writeFileSync(newFile, fs.readFileSync(file));

    callback(url.resolve('file://', newFile));
}

module.exports = Service;
