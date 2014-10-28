// Load modules

var Hoek = require('hoek');
var Items = require('items');
var Kilt = require('kilt');
var Topo = require('topo');
var Vision = require('vision');
var Schema = require('./schema');
var Server = require('./server');
var Utils = require('./utils');


// Declare internals

var internals = {};


exports = module.exports = internals.Plugin = function (pack, connections, env, options) {

    var self = this;

    // Validate options

    options = options || {};
    Schema.assert('register', options);

    // Setup environment

    this._pack = pack;
    this._env = typeof env !== 'string' ? env : {
        name: env,
        path: null,
        bind: null,
        views: null,
        route: {
            prefix: options.route && options.route.prefix,
            vhost: options.route && options.route.vhost
        }
    };

    this.connections = connections;
    this.servers = this.connections;                                            // Backwards compatibility
    this.length = this.connections.length;                                      // Backwards compatibility

    this.hapi = require('../');
    this.version = this.hapi.version;
    this.config = { route: this._env.route };
    this.methods = this._pack._methods.methods;

    if (this !== this._pack) {
        this.app = this._pack.app;
        this.plugins = this._pack.plugins;
        this.events = new Kilt(this.connections, this._pack._events);           // Overrides pack.events
    }

    this.auth = {
        scheme: function () {

            internals.applyChildSync(self.connections, 'auth', 'scheme', arguments);
        },
        strategy: function () {

            internals.applyChildSync(self.connections, 'auth', 'strategy', arguments);
        }
    };
};


internals.Plugin.prototype.select = function (/* labels */) {

    var labels = Hoek.flatten(Array.prototype.slice.call(arguments));
    return this._select(labels);
};


internals.Plugin.prototype._select = function (labels, name, options) {

    var connections = this.connections;

    if (labels) {
        Hoek.assert(typeof labels === 'string' || Array.isArray(labels), 'Bad labels object type (undefined or array required)');
        labels = [].concat(labels);

        connections = [];
        for (var i = 0, il = this.connections.length; i < il; ++i) {
            var connection = this.connections[i];
            if (Hoek.intersect(connection.settings.labels, labels).length) {
                connections.push(connection);
            }
        }

        if (!name &&
            connections.length === this.connections.length) {

            return this;
        }
    }

    return new internals.Plugin(this._pack, connections, name || this._env, options);
};


internals.Plugin.prototype.register = function (plugins /*, [options], callback */) {

    var self = this;

    var options = (typeof arguments[1] === 'object' ? arguments[1] : {});
    var callback = (typeof arguments[1] === 'object' ? arguments[2] : arguments[1]);

    Hoek.assert(typeof callback === 'function', 'A callback function is required to register a plugin');

    if (this._env.route.prefix ||
        this._env.route.vhost) {

        options = Hoek.clone(options);
        options.route = options.route || {};

        options.route.prefix = (this._env.route.prefix || '') + (options.route.prefix || '') || undefined;
        options.route.vhost = this._env.route.vhost || options.route.vhost;
    }

    /*
        var register = function (plugin, options, next) { next(); }
        register.attributes = {
            name: 'plugin',
            version: '1.1.1',
            pkg: require('../package.json'),
            multiple: false
        };

        plugin = {
            register: register,     // plugin: { register } when assigned a directly required module
            name: 'plugin',         // || register.attributes.name  || register.attributes.pkg.name
            version: '1.1.1',       // -optional- || register.attributes.version  || register.attributes.pkg.version
            multiple: false,        // -optional- || register.attributes.multiple
            options: {}             // -optional-
        };
    */

    var registrations = [];
    plugins = [].concat(plugins);
    for (var i = 0, il = plugins.length; i < il; ++i) {
        var plugin = plugins[i];
        var hint = (plugins.length > 1 ? '(' + i + ')' : '');

        Hoek.assert(typeof plugin === 'object', 'Invalid plugin object', hint);
        Hoek.assert(!!plugin.register ^ !!plugin.plugin, 'One of plugin or register required but cannot include both', hint);
        Hoek.assert(typeof plugin.register === 'function' || (plugin.plugin && typeof plugin.plugin.register === 'function'), 'Plugin register must be a function or a required plugin module', hint);

        var register = plugin.register || plugin.plugin.register;
        var attributes = register.attributes || {};

        Hoek.assert(plugin.name || attributes, 'Incompatible plugin missing register function attributes', hint);
        Hoek.assert(plugin.name || attributes.name || (attributes.pkg && attributes.pkg.name), 'Missing plugin name', hint);

        var item = {
            register: register,
            name: plugin.name || attributes.name || attributes.pkg.name,
            version: plugin.version || attributes.version || (attributes.pkg && attributes.pkg.version) || '0.0.0',
            multiple: plugin.multiple || attributes.multiple || false,
            options: plugin.options
        };

        registrations.push(item);
    }

    Items.serial(registrations, function (item, next) {

        // Setup pack interface

        var selection = self._select(options.select, item.name, options);

        // Protect against multiple registrations

        for (var i = 0, il = selection.connections.length; i < il; ++i) {
            var server = selection.connections[i];
            Hoek.assert(item.multiple || !server._registrations[item.name], 'Plugin', item.name, 'already registered in:', server.info.uri);
            server._registrations[item.name] = item;
        }

        // Register

        item.register.call(null, selection, item.options || {}, next);
    }, callback);
};


internals.Plugin.prototype.expose = function (/* key, value */) {

    Hoek.assert(this._env.name, 'Cannot call expose() outside of a plugin');

    internals.expose(this.connections, this._env.name, arguments);              // server.plugins

    if (this.connections.length === this._pack.connections.length) {
        internals.expose([this._pack], this._env.name, arguments);          // pack.plugins
    }
};


internals.expose = function (dests, name, args) {

    var key = (args.length === 2 ? args[0] : null);
    var value = (args.length === 2 ? args[1] : args[0]);

    dests.forEach(function (dest) {

        dest.plugins[name] = dest.plugins[name] || {};
        if (key) {
            dest.plugins[name][key] = value;
        }
        else {
            Hoek.merge(dest.plugins[name], value);
        }
    });
};


internals.Plugin.prototype.route = function (options) {

    internals.applySync(this.connections, Server.prototype._route, [options, this._env]);
};


internals.Plugin.prototype.state = function () {

    internals.applySync(this.connections, Server.prototype.state, arguments);
};


internals.Plugin.prototype.ext = function () {

    internals.applySync(this.connections, Server.prototype._ext, [arguments[0], arguments[1], arguments[2], this._env]);
};


internals.Plugin.prototype.dependency = function (deps, after) {

    Hoek.assert(this._env.name, 'Cannot call dependency() outside of a plugin');
    Hoek.assert(!after || typeof after === 'function', 'Invalid after method');

    deps = [].concat(deps);
    this._pack._dependencies.push({ plugin: this._env.name, connections: this.connections, deps: deps });

    if (after) {
        this._after(after, deps);
    }
};


internals.Plugin.prototype._after = function (func, after) {

    this._pack._afters = this._pack._afters || new Topo();
    this._pack._afters.add({ func: func, plugin: this }, { after: after, group: this._env.name });
};


internals.Plugin.prototype.log = function (tags, data, timestamp, _server) {

    tags = (Array.isArray(tags) ? tags : [tags]);
    var now = (timestamp ? (timestamp instanceof Date ? timestamp.getTime() : timestamp) : Date.now());

    var event = {
        server: (_server ? _server.info.uri : undefined),
        timestamp: now,
        tags: tags,
        data: data
    };

    var tagsMap = Hoek.mapToObject(event.tags);
    (_server || this._pack._events).emit('log', event, tagsMap);

    if (this._pack._settings.debug &&
        this._pack._settings.debug.request &&
        Hoek.intersect(tagsMap, this._pack._settings.debug.request, true)) {

        console.error('Debug:', event.tags.join(', '), (data ? '\n    ' + (data.stack || (typeof data === 'object' ? Utils.stringify(data) : data)) : ''));
    }
};


internals.Plugin.prototype.after = function (func) {

    Hoek.assert(this._env.name, 'Cannot call after() outside of a plugin');
    this._after(func);
};


internals.Plugin.prototype.bind = function (bind) {

    Hoek.assert(typeof bind === 'object', 'bind must be an object');
    this._env.bind = bind;
};


internals.Plugin.prototype.path = function (path) {

    Hoek.assert(path && typeof path === 'string', 'path must be a non-empty string');
    this._env.path = path;
};


internals.Plugin.prototype.views = function (options) {

    Hoek.assert(options, 'Missing views options');
    Hoek.assert(!this._env.views, 'Cannot set views manager more than once');

    if (!options.basePath &&
        this._env.path) {

        options = Utils.shallow(options);
        options.basePath = this._env.path;
    }

    this._env.views = new Vision.Manager(options);
};


internals.Plugin.prototype.render = function (template, context, options, callback) {

    callback = (typeof callback === 'function' ? callback : options);
    options = (options === callback ? {} : options);

    Hoek.assert(this._env.views, 'Missing views manager');
    return this._env.views.render(template, context, options, callback);
};


internals.Plugin.prototype.method = function (name, method, options) {

    return this._pack._methods.add(name, method, options, this._env);
};


internals.Plugin.prototype.handler = function (name, method) {

    Hoek.assert(typeof name === 'string', 'Invalid handler name');
    Hoek.assert(!this._pack._handlers[name], 'Handler name already exists:', name);
    Hoek.assert(typeof method === 'function', 'Handler must be a function:', name);
    Hoek.assert(!method.defaults || typeof method.defaults === 'object' || typeof method.defaults === 'function', 'Handler defaults property must be an object or function');
    this._pack._handlers[name] = method;
};


internals.Plugin.prototype.cache = function (/* name, options */) {

    var name = typeof arguments[0] === 'string' ? arguments[0] : '';
    var options = typeof arguments[0] === 'string' ? arguments[1] : arguments[0];

    if (this._env.name) {
        return this._pack._provisionCache(options, 'plugin', this._env.name, options.segment);
    }

    Schema.assert('cachePolicy', options, name);
    Hoek.assert(!options.segment, 'Cannot override segment name in server cache');
    return this._pack._provisionCache(options, 'server', name);
};


internals.applySync = function (connections, func, args) {

    for (var i = 0, il = connections.length; i < il; ++i) {
        func.apply(connections[i], args);
    }
};


internals.applyChildSync = function (connections, child, func, args) {

    for (var i = 0, il = connections.length; i < il; ++i) {
        var obj = connections[i][child];
        obj[func].apply(obj, args);
    }
};