"use strict";

exports.__esModule = true;
exports.default = void 0;

var _axios = _interopRequireDefault(require("axios"));

var _debug2 = _interopRequireDefault(require("debug"));

var _eventemitter = require("eventemitter2");

var _urlParse = _interopRequireDefault(require("url-parse"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _inheritsLoose(subClass, superClass) { subClass.prototype = Object.create(superClass.prototype); subClass.prototype.constructor = subClass; subClass.__proto__ = superClass; }

var debug = {
  log: (0, _debug2.default)('superlogin:log'),
  info: (0, _debug2.default)('superlogin:info'),
  warn: (0, _debug2.default)('superlogin:warn'),
  error: (0, _debug2.default)('superlogin:error') // Capitalizes the first letter of a string

};

var capitalizeFirstLetter = function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

var parseHostFromUrl = function parseHostFromUrl(url) {
  var parsedURL = new _urlParse.default(url);
  return parsedURL.host;
};

var checkEndpoint = function checkEndpoint(url, endpoints) {
  var host = parseHostFromUrl(url);
  return endpoints.findIndex(function (i) {
    return i === host;
  }) > -1;
};

var isStorageAvailable = function isStorageAvailable() {
  var mod = '__STORAGE__';

  try {
    localStorage.setItem(mod, mod);
    localStorage.removeItem(mod);
    return true;
  } catch (e) {
    return false;
  }
}; // if no connection can be established we don't have any data thus we need to forward the original error.


var parseError = function parseError(err) {
  return err && err.response && err.response.data ? err.response.data : err;
};

var memoryStorage = {
  setItem: function setItem(key, value) {
    memoryStorage.storage.set(key, value);
  },
  getItem: function getItem(key) {
    var value = memoryStorage.storage.get(key);

    if (typeof value !== 'undefined') {
      return value;
    }

    return null;
  },
  removeItem: function removeItem(key) {
    memoryStorage.storage.delete(key);
  },
  storage: new Map()
};

var Superlogin =
/*#__PURE__*/
function (_EventEmitter) {
  _inheritsLoose(Superlogin, _EventEmitter);

  function Superlogin() {
    var _this;

    _this = _EventEmitter.call(this) || this;
    _this._oauthComplete = false;
    _this._config = {};
    _this._refreshInProgress = false;
    _this._http = _axios.default.create();
    return _this;
  }

  var _proto = Superlogin.prototype;

  _proto.configure = function configure(config) {
    var _this2 = this;

    if (config === void 0) {
      config = {};
    }

    if (config.serverUrl) {
      this._http = _axios.default.create({
        baseURL: config.serverUrl,
        timeout: config.timeout
      });
    }

    config.baseUrl = config.baseUrl || '/auth';
    config.baseUrl = config.baseUrl.replace(/\/$/, ''); // remove trailing /

    config.socialUrl = config.socialUrl || config.baseUrl;
    config.socialUrl = config.socialUrl.replace(/\/$/, ''); // remove trailing /

    config.local = config.local || {};
    config.local.usernameField = config.local.usernameField || 'username';
    config.local.passwordField = config.local.passwordField || 'password';

    if (!config.endpoints || !(config.endpoints instanceof Array)) {
      config.endpoints = [];
    }

    if (!config.noDefaultEndpoint) {
      var defaultEndpoint = window.location.host;

      if (config.serverUrl) {
        defaultEndpoint = parseHostFromUrl(config.serverUrl);
      }

      config.endpoints.push(defaultEndpoint);
    }

    config.providers = config.providers || [];
    config.timeout = config.timeout || 0;

    if (!isStorageAvailable()) {
      this.storage = memoryStorage;
    } else if (config.storage === 'session') {
      this.storage = window.sessionStorage;
    } else {
      this.storage = window.localStorage;
    }

    this._config = config; // Setup the new session

    this._session = JSON.parse(this.storage.getItem('superlogin.session'));

    this._httpInterceptor(); // Check expired


    if (config.checkExpired) {
      this.checkExpired();
      this.validateSession().then(function () {
        _this2._onLogin(_this2._session);
      }).catch(function () {// ignoring
      });
    }
  };

  _proto._httpInterceptor = function _httpInterceptor() {
    var _this3 = this;

    var request = function request(req) {
      var config = _this3.getConfig();

      var session = _this3.getSession();

      if (!session || !session.token) {
        return Promise.resolve(req);
      }

      if (req.skipRefresh) {
        return Promise.resolve(req);
      }

      return _this3.checkRefresh().then(function () {
        if (checkEndpoint(req.url, config.endpoints)) {
          req.headers.Authorization = "Bearer " + session.token + ":" + session.password;
        }

        return req;
      });
    };

    var responseError = function responseError(error) {
      var config = _this3.getConfig(); // if there is not config obj in in the error it means we cannot check the endpoints.
      // This happens for example if there is no connection at all because axion just forwards the raw error.


      if (!error || !error.config) {
        return Promise.reject(error);
      } // If there is an unauthorized error from one of our endpoints and we are logged in...


      if (checkEndpoint(error.config.url, config.endpoints) && error.response && error.response.status === 401 && _this3.authenticated()) {
        debug.warn('Not authorized');

        _this3._onLogout('Session expired');
      }

      return Promise.reject(error);
    }; // clear interceptors from a previous configure call


    this._http.interceptors.request.eject(this._httpRequestInterceptor);

    this._http.interceptors.response.eject(this._httpResponseInterceptor);

    this._httpRequestInterceptor = this._http.interceptors.request.use(request.bind(this));
    this._httpResponseInterceptor = this._http.interceptors.response.use(null, responseError.bind(this));
  };

  _proto.authenticated = function authenticated() {
    return !!(this._session && this._session.user_id);
  };

  _proto.getConfig = function getConfig() {
    return this._config;
  };

  _proto.validateSession = function validateSession() {
    var _this4 = this;

    if (!this.authenticated()) {
      return Promise.reject();
    }

    return this._http.get(this._config.baseUrl + "/session").catch(function (err) {
      _this4._onLogout('Session expired');

      throw parseError(err);
    });
  };

  _proto.getSession = function getSession() {
    if (!this._session) {
      this._session = JSON.parse(this.storage.getItem('superlogin.session'));
    }

    return this._session ? Object.assign(this._session) : null;
  };

  _proto.setSession = function setSession(session) {
    this._session = session;
    this.storage.setItem('superlogin.session', JSON.stringify(this._session));
    debug.info('New session set');
  };

  _proto.deleteSession = function deleteSession() {
    this.storage.removeItem('superlogin.session');
    this._session = null;
  };

  _proto.getDbUrl = function getDbUrl(dbName) {
    if (this._session.userDBs && this._session.userDBs[dbName]) {
      return this._session.userDBs[dbName];
    }

    return null;
  };

  _proto.getHttp = function getHttp() {
    return this._http;
  };

  _proto.confirmRole = function confirmRole(role) {
    if (!this._session || !this._session.roles || !this._session.roles.length) return false;
    return this._session.roles.indexOf(role) !== -1;
  };

  _proto.confirmAnyRole = function confirmAnyRole(roles) {
    if (!this._session || !this._session.roles || !this._session.roles.length) return false;

    for (var i = 0; i < roles.length; i += 1) {
      if (this._session.roles.indexOf(roles[i]) !== -1) return true;
    }

    return false;
  };

  _proto.confirmAllRoles = function confirmAllRoles(roles) {
    if (!this._session || !this._session.roles || !this._session.roles.length) return false;

    for (var i = 0; i < roles.length; i += 1) {
      if (this._session.roles.indexOf(roles[i]) === -1) return false;
    }

    return true;
  };

  _proto.checkRefresh = function checkRefresh() {
    // Get out if we are not authenticated or a refresh is already in progress
    if (this._refreshInProgress) {
      return Promise.resolve();
    }

    if (!this._session || !this._session.user_id) {
      return Promise.reject();
    } // try getting the latest refresh date, if not available fall back to issued date


    var refreshed = this._session.refreshed || this._session.issued;
    var expires = this._session.expires;
    var threshold = this._config.refreshThreshold !== undefined ? this._config.refreshThreshold : 0.5;
    var duration = expires - refreshed;
    var timeDiff = this._session.serverTimeDiff || 0;

    if (Math.abs(timeDiff) < 5000) {
      timeDiff = 0;
    }

    var estimatedServerTime = Date.now() + timeDiff;
    var elapsed = estimatedServerTime - refreshed;
    var ratio = elapsed / duration;

    if (ratio > threshold) {
      debug.info('Refreshing session');
      return this.refresh().then(function (session) {
        debug.log('Refreshing session sucess', session);
        return session;
      }).catch(function (err) {
        debug.error('Refreshing session failed', err);
        throw err;
      });
    }

    return Promise.resolve();
  };

  _proto.checkExpired = function checkExpired() {
    // This is not necessary if we are not authenticated
    if (!this.authenticated()) {
      return;
    }

    var expires = this._session.expires;
    var timeDiff = this._session.serverTimeDiff || 0; // Only compensate for time difference if it is greater than 5 seconds

    if (Math.abs(timeDiff) < 5000) {
      timeDiff = 0;
    }

    var estimatedServerTime = Date.now() + timeDiff;

    if (estimatedServerTime > expires) {
      this._onLogout('Session expired');
    }
  };

  _proto.refresh = function refresh() {
    var _this5 = this;

    var session = this.getSession();
    this._refreshInProgress = true;
    return this._http.post(this._config.baseUrl + "/refresh", {}).then(function (res) {
      _this5._refreshInProgress = false;

      if (res.data.token && res.data.expires) {
        Object.assign(session, res.data);

        _this5.setSession(session);

        _this5._onRefresh(session);
      }

      return session;
    }).catch(function (err) {
      _this5._refreshInProgress = false;
      throw parseError(err);
    });
  };

  _proto.authenticate = function authenticate() {
    var _this6 = this;

    return new Promise(function (resolve) {
      var session = _this6.getSession();

      if (session) {
        resolve(session);
      } else {
        _this6.on('login', function (newSession) {
          resolve(newSession);
        });
      }
    });
  };

  _proto.login = function login(credentials) {
    var _this7 = this;

    var _config$local = this._config.local,
        usernameField = _config$local.usernameField,
        passwordField = _config$local.passwordField;

    if (!credentials[usernameField] || !credentials[passwordField]) {
      return Promise.reject({
        error: 'Username or Password missing...'
      });
    }

    return this._http.post(this._config.baseUrl + "/login", credentials, {
      skipRefresh: true
    }).then(function (res) {
      res.data.serverTimeDiff = res.data.issued - Date.now();

      _this7.setSession(res.data);

      _this7._onLogin(res.data);

      return res.data;
    }).catch(function (err) {
      _this7.deleteSession();

      throw parseError(err);
    });
  };

  _proto.register = function register(registration) {
    var _this8 = this;

    return this._http.post(this._config.baseUrl + "/register", registration, {
      skipRefresh: true
    }).then(function (res) {
      if (res.data.user_id && res.data.token) {
        res.data.serverTimeDiff = res.data.issued - Date.now();

        _this8.setSession(res.data);

        _this8._onLogin(res.data);
      }

      _this8._onRegister(registration);

      return res.data;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.logout = function logout(msg) {
    var _this9 = this;

    return this._http.post(this._config.baseUrl + "/logout", {}).then(function (res) {
      _this9._onLogout(msg || 'Logged out');

      return res.data;
    }).catch(function (err) {
      _this9._onLogout(msg || 'Logged out');

      if (!err.response || err.response.data.status !== 401) {
        throw parseError(err);
      }
    });
  };

  _proto.logoutAll = function logoutAll(msg) {
    var _this10 = this;

    return this._http.post(this._config.baseUrl + "/logout-all", {}).then(function (res) {
      _this10._onLogout(msg || 'Logged out');

      return res.data;
    }).catch(function (err) {
      _this10._onLogout(msg || 'Logged out');

      if (!err.response || err.response.data.status !== 401) {
        throw parseError(err);
      }
    });
  };

  _proto.logoutOthers = function logoutOthers() {
    return this._http.post(this._config.baseUrl + "/logout-others", {}).then(function (res) {
      return res.data;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.socialAuth = function socialAuth(provider) {
    var providers = this._config.providers;

    if (providers.indexOf(provider) === -1) {
      return Promise.reject({
        error: "Provider " + provider + " not supported."
      });
    }

    var url = this._config.socialUrl + "/" + provider;
    return this._oAuthPopup(url, {
      windowTitle: "Login with " + capitalizeFirstLetter(provider)
    });
  };

  _proto.tokenSocialAuth = function tokenSocialAuth(provider, accessToken) {
    var _this11 = this;

    var providers = this._config.providers;

    if (providers.indexOf(provider) === -1) {
      return Promise.reject({
        error: "Provider " + provider + " not supported."
      });
    }

    return this._http.post(this._config.baseUrl + "/" + provider + "/token", {
      access_token: accessToken
    }).then(function (res) {
      if (res.data.user_id && res.data.token) {
        res.data.serverTimeDiff = res.data.issued - Date.now();

        _this11.setSession(res.data);

        _this11._onLogin(res.data);
      }

      return res.data;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.tokenLink = function tokenLink(provider, accessToken) {
    var providers = this._config.providers;

    if (providers.indexOf(provider) === -1) {
      return Promise.reject({
        error: "Provider " + provider + " not supported."
      });
    }

    var linkURL = this._config.baseUrl + "/link/" + provider + "/token";
    return this._http.post(linkURL, {
      access_token: accessToken
    }).then(function (res) {
      return res.data;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.link = function link(provider) {
    var providers = this._config.providers;

    if (providers.indexOf(provider) === -1) {
      return Promise.reject({
        error: "Provider " + provider + " not supported."
      });
    }

    if (this.authenticated()) {
      var session = this.getSession();
      var token = "bearer_token=" + session.token + ":" + session.password;
      var linkURL = this._config.socialUrl + "/link/" + provider + "?" + token;
      var windowTitle = "Link your account to " + capitalizeFirstLetter(provider);
      return this._oAuthPopup(linkURL, {
        windowTitle: windowTitle
      });
    }

    return Promise.reject({
      error: 'Authentication required'
    });
  };

  _proto.unlink = function unlink(provider) {
    var providers = this._config.providers;

    if (providers.indexOf(provider) === -1) {
      return Promise.reject({
        error: "Provider " + provider + " not supported."
      });
    }

    if (this.authenticated()) {
      return this._http.post(this._config.baseUrl + "/unlink/" + provider).then(function (res) {
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }

    return Promise.reject({
      error: 'Authentication required'
    });
  };

  _proto.confirmEmail = function confirmEmail(token) {
    if (!token || typeof token !== 'string') {
      return Promise.reject({
        error: 'Invalid token'
      });
    }

    return this._http.get(this._config.baseUrl + "/confirm-email/" + token).then(function (res) {
      return res.data;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.forgotPassword = function forgotPassword(email) {
    return this._http.post(this._config.baseUrl + "/forgot-password", {
      email: email
    }, {
      skipRefresh: true
    }).then(function (res) {
      return res.data;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.resetPassword = function resetPassword(form) {
    var _this12 = this;

    return this._http.post(this._config.baseUrl + "/password-reset", form, {
      skipRefresh: true
    }).then(function (res) {
      if (res.data.user_id && res.data.token) {
        _this12.setSession(res.data);

        _this12._onLogin(res.data);
      }

      return res.data;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.changePassword = function changePassword(form) {
    if (this.authenticated()) {
      return this._http.post(this._config.baseUrl + "/password-change", form).then(function (res) {
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }

    return Promise.reject({
      error: 'Authentication required'
    });
  };

  _proto.changeEmail = function changeEmail(newEmail) {
    if (this.authenticated()) {
      return this._http.post(this._config.baseUrl + "/change-email", {
        newEmail: newEmail
      }).then(function (res) {
        return res.data;
      }).catch(function (err) {
        throw parseError(err);
      });
    }

    return Promise.reject({
      error: 'Authentication required'
    });
  };

  _proto.validateUsername = function validateUsername(username) {
    return this._http.get(this._config.baseUrl + "/validate-username/" + encodeURIComponent(username)).then(function () {
      return true;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto.validateEmail = function validateEmail(email) {
    return this._http.get(this._config.baseUrl + "/validate-email/" + encodeURIComponent(email)).then(function () {
      return true;
    }).catch(function (err) {
      throw parseError(err);
    });
  };

  _proto._oAuthPopup = function _oAuthPopup(url, options) {
    var _this13 = this;

    return new Promise(function (resolve, reject) {
      _this13._oauthComplete = false;
      options.windowName = options.windowTitle || 'Social Login';
      options.windowOptions = options.windowOptions || 'location=0,status=0,width=800,height=600';

      var _oauthWindow = window.open(url, options.windowName, options.windowOptions);

      if (!_oauthWindow) {
        return reject(new Error('Authorization popup blocked'));
      }

      var _oauthInterval = setInterval(function () {
        if (!_oauthWindow) {
          clearInterval(_oauthInterval);

          if (!_this13._oauthComplete) {
            _this13.authComplete = true;
            return reject(new Error('Authorization failed'));
          }

          return undefined;
        }

        if (_oauthWindow.closed) {
          clearInterval(_oauthInterval);

          if (!_this13._oauthComplete) {
            _this13.authComplete = true;
            return reject(new Error('Authorization cancelled'));
          }
        }

        return undefined;
      }, 500);

      var callback = function callback(_ref) {
        var _ref$data = _ref.data,
            error = _ref$data.error,
            session = _ref$data.session,
            link = _ref$data.link,
            type = _ref$data.type;

        if (type === 'oauthSession') {
          window.removeEventListener('message', callback);

          if (!error && session) {
            session.serverTimeDiff = session.issued - Date.now();

            _this13.setSession(session);

            _this13._onLogin(session);

            return resolve(session);
          } else if (!error && link) {
            _this13._onLink(link);

            return resolve(capitalizeFirstLetter(link) + " successfully linked.");
          }

          _this13._oauthComplete = true;
          return reject(new Error(error));
        }

        return undefined;
      };

      return window.addEventListener('message', callback);
    });
  };

  _proto._onLogin = function _onLogin(msg) {
    debug.info('Login', msg);
    this.emit('login', msg);
  };

  _proto._onLogout = function _onLogout(msg) {
    this.deleteSession();
    debug.info('Logout', msg);
    this.emit('logout', msg);
  };

  _proto._onLink = function _onLink(msg) {
    debug.info('Link', msg);
    this.emit('link', msg);
  };

  _proto._onRegister = function _onRegister(msg) {
    debug.info('Register', msg);
    this.emit('register', msg);
  };

  _proto._onRefresh = function _onRefresh(msg) {
    debug.info('Refresh', msg);
    this.emit('refresh', msg);
  };

  return Superlogin;
}(_eventemitter.EventEmitter2);

var _default = new Superlogin();

exports.default = _default;