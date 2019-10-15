import SentryConfig from './config';
import SentrySDK from './sdk';
import MockXMLHttpRequest from './mock-xmlhttprequest';
import DefaultMerge from './merge';
import { supportRewrite, getSentryContexts, getSysInfo, runHook, uuid, isSyncApi, getEntityName, getEntityLabel, getEntityId, getPage, getFullUrl, parseUrlSearch } from './util';

// TODO: 用户接入sentry
// TODO: 拦截setTimeout等原生函数
// TODO: ui动作（tap/input等）添加面包屑

// merge出最后的配置对象
const config = Object.assign({}, SentryConfig, {
    defaultIntegrations: false,
    maxBreadcrumbs: SentryConfig.maxBreadcrumbs || 100
});
// 将Sentry不支持的自定义配置项删除
['nogetValue', 'printError', 'requestHandler', 'breadcrumbs', 'autoCapture'].forEach(item => {
    delete config[item];
});

const NOGET = SentryConfig.nogetValue;
const XMLHttpRequest = MockXMLHttpRequest(SentryConfig.requestHandler);
const Sentry = SentrySDK(XMLHttpRequest, config.maxBreadcrumbs);

// 初始化Sentry服务
config.integrations = config.integrations || [];
config.integrations.push(
    new Sentry.Integrations.InboundFilters(),
    new Sentry.Integrations.FunctionToString(),
    new Sentry.Integrations.TryCatch(),
    new Sentry.Integrations.LinkedErrors(),
    new Sentry.Integrations.GlobalHandlers({
        onerror: false,
        onunhandledrejection: false
    }),
    new Sentry.Integrations.Breadcrumbs({
        console: false,
        xhr: false,
        dom: false,
        fetch: false,
        history: false,
        beacon: false
    }));
Sentry.init(config);
// 将小程序的系统信息转换为Sentry可识别的格式，并在tags中添加小程序的sdk版本
Sentry.configureScope(scope => {
    scope.addEventProcessor(event => {
        event.tags = event.tags || {};
        event.contexts = getSentryContexts(NOGET);
        event.tags.mpSDKVersion = getSysInfo({}).SDKVersion || NOGET;
        return event;
    });
});

const sensitiveData = (data, ...args) => {
    if (typeof SentryConfig.sensitiveHandler === 'function') {
        data = SentryConfig.sensitiveHandler.apply(null, [data].concat(args));
    }
    return data;
}
const simplifyData = (data, ...args) => {
    if (typeof SentryConfig.simplifyHandler === 'function') {
        data = SentryConfig.simplifyHandler.apply(null, [data].concat(args));
    }
    return data;
}

/**
 * 过滤数据
 * @param {String} type 可选值：errRquest=请求异常的request data；errResponse=请求异常的request result；request=请求成功的request data；response=请求成功的request result；{wxApi|app|page|component}Arguments={wxApi|app|page|component}的方法参数；{wxApi|app|page|component}Result={wxApi|app|page|component}的方法执行结果；consoleArguments=console方法的参数
 * @param {any} data 对象
 */
const filterData = (type, data) => {
    data = sensitiveData(data);
    let allow = true;
    if (type.endsWith('Arguments') || type.endsWith('Result')) {
        let index = type.indexOf('Arguments');
        let subType = 'arguments';
        if (index === -1) {
            index = type.indexOf('Result')
            subType = 'result';
        }
        let before = type.substr(0, index);
        let hnConfig;
        let isError;
        if (before.endsWith('Error')) {
            isError = true;
            before = before.substr(0, before.indexOf('Error'));
            hnConfig = HookNative[`${before}AutoCapture`];
        } else {
            hnConfig = HookNative[`${before}Breadcrumbs`];
        }
        if (!hnConfig || !hnConfig[subType]) {
            // 配置中关闭了对此项数据的监控
            allow = false;
        } else if (hnConfig[subType] !== 'full') {
            data = simplifyData(data, before, subType, isError ? 'autoCapture' : 'breadcrumbs');
        }
    } else if (type.endsWith('Request') || type.endsWith('Response')) {
        const subType = type.endsWith('Request') ? 'request' : 'response';
        if (type.startsWith('err')) {
            if (!HookNative.requestAutoCapture || !HookNative.requestAutoCapture[subType]) {
                allow = false;
            } else if (HookNative.requestAutoCapture[subType] !== 'full') {
                data = simplifyData(data, 'Request', subType, 'autoCapture');
            }
        } else {
            if (!HookNative.requestBreadcrumbs || !HookNative.requestBreadcrumbs[subType]) {
                allow = false;
            } else if (HookNative.requestBreadcrumbs[subType] !== 'full') {
                data = simplifyData(data, 'Request', subType, 'breadcrumbs');
            }
        }
    }
    return allow ? data : (Array.isArray(data) ? [] : null);
}
const captureException = (error, tags, extra) => {
    Sentry.configureScope(scope => {
        scope.setLevel('error');
        if (tags) {
            Object.keys(tags).forEach(key => {
                scope.setTag(key, tags[key]);
                scope.setExtra(key, tags[key]);
            });
        }
        if (extra) {
            Object.keys(extra).forEach(key => {
                scope.setExtra(key, extra[key]);
            });
        }
        Sentry.captureException(error);
    });
}
const captureAppOnError = err => {
    const arr = err.split('\n');
    const error = new Error(arr[1]);
    error.name = arr[0];
    const stackArr = arr.splice(2);
    error.stack = stackArr.join('\n');
    setTimeout(() => {
        captureException(error)
    });
}
const captureAppOnPageNotFound = err => {
    Sentry.configureScope(scope => {
        scope.setLevel('error');
        scope.setExtra('notFoundDetail', err);
        Sentry.captureMessage(`未找到页面：${err.path}`);
    });
}

const HookNative = {
    App: false,
    Page: false,
    Component: false,
    WxApi: false,
    appAutoCapture: false,
    pageAutoCapture: false,
    componentAutoCapture: false,
    appBreadcrumbs: false,
    pageBreadcrumbs: false,
    componentBreadcrumbs: false,
    consoleBreadcrumbs: false,
    consoleAutoCapture: false,
    requestBreadcrumbs: false,
    requestAutoCapture: false,
    wxApiAutoCapture: false,
    wxApiBreadcrumbs: false,
    historyBreadcrumbs: false,

    appOnError: false,
    appOnPageNotFound: false
};

// 根据配置计算出需要拦截哪些系统函数（App、Page、Component、wx对象上的相关api）
const routeApis = ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab', 'navigateBack'];
const nativeTypes = ['console', 'request', 'wxApi', 'history'];
const breadcrumbInvalidDatas = ['request', 'response', 'result', 'arguments'];
['autoCapture', 'breadcrumbs'].forEach(prop => {
    if (SentryConfig[prop]) {
        const upperProp = prop[0].toUpperCase() + prop.substr(1);
        if (SentryConfig[prop].methods === false) {
        } else if (SentryConfig[prop].methods === true) {
            HookNative.App = true;
            HookNative.Page = true;
            HookNative.Component = true;
            HookNative[`app${upperProp}`] = true;
            HookNative[`page${upperProp}`] = true;
            HookNative[`component${upperProp}`] = true;
        } else if (typeof SentryConfig[prop].methods === 'object' && SentryConfig[prop].methods) {
            if (SentryConfig[prop].methods.app) {
                HookNative.App = true;
                HookNative[`app${upperProp}`] = SentryConfig[prop].methods.app;
            }
            if (SentryConfig[prop].methods.page) {
                HookNative.Page = true;
                HookNative[`page${upperProp}`] = SentryConfig[prop].methods.page;
            }
            if (SentryConfig[prop].methods.component) {
                HookNative.Component = true;
                HookNative[`component${upperProp}`] = SentryConfig[prop].methods.component;
            }
        }
        nativeTypes.forEach(item => {
            if (SentryConfig[prop][item]) {
                if (item === 'wxApi') {
                    HookNative.WxApi = true;
                }
                HookNative[`${item}${upperProp}`] = SentryConfig[prop][item];
            }
        });
        if (prop === 'autoCapture') {
            if (SentryConfig[prop].appOnError) {
                HookNative.appOnError = true;
            }
            if (SentryConfig[prop].appOnPageNotFound) {
                HookNative.appOnPageNotFound = true;
            }
        }
    }
});
const getEntityKey = (vm, eLabel, eId) => {
    if (!vm) return NOGET;
    eLabel = eLabel || getEntityLabel(vm, NOGET);
    eId = eId || getEntityId(vm, NOGET);
    return `{${eId}} ${eLabel}`;
}
const sentryMethod = (type, batch, funName, args, funResult, error, ctx) => {
    const eName = getEntityName(ctx, NOGET);
    const lowerName = eName[0].toLowerCase() + eName.substr(1);
    const eLabel = getEntityLabel(ctx, NOGET);
    if (error && error instanceof Error) {
        const tags = {};
        const extra = {};
        // 捕获异常
        if (eName === 'Wx' && funName === 'request') {
            if (!HookNative.requestAutoCapture) {
                return;
            }
            tags.requestUrl = (args[0] || { url: NOGET }).url;
            tags.requestUrl = tags.requestUrl.split('?');
            extra.requestQuery = parseUrlSearch(tags.requestUrl[1] || '');
            extra.requestQuery = filterData('errRequest', extra.requestQuery);
            tags.requestUrl = tags.requestUrl[0];
            extra.requestData = filterData('errRequest', args[0] ? args[0].data : null);
            extra.responseData = filterData('errResponse', funResult);
        } else if (!HookNative[`${lowerName}AutoCapture`]) {
            return;
        }
        Object.assign(tags, {
            entityName: eName,
            entityLabel: eLabel,
            methodName: funName
        });
        Object.assign(extra, {
            methodArguments: filterData(`${lowerName}ErrorArguments`, args),
            methodBatch: batch
        });
        if (eName !== 'Wx') {
            Object.assign(extra, {
                entityId: getEntityId(ctx, NOGET)
            });
        }
        captureException(error, tags, extra);
    } else {
        // 添加面包屑
        let breadcrumb = {};
        if (eName === 'Wx') {
            if (funName === 'request') {
                if (!HookNative.requestBreadcrumbs) {
                    return;
                }
                const data = args[0] || {};
                const method = (data.method || NOGET).toUpperCase();
                const url = data.url || NOGET;
                breadcrumb = {}
                if (type === 'before') {
                    breadcrumb.category = 'Request';
                    breadcrumb.level = 'info';
                    breadcrumb.type = 'default';
                    breadcrumb.message = `${type}/${batch}: ${method} ${url}`;
                } else {
                    const statusCode = funResult && funResult.statusCode ? funResult.statusCode : NOGET;
                    breadcrumb.type = 'http';
                    breadcrumb.category = 'xhr';
                    breadcrumb.level = statusCode === 200 ? 'success' : 'error';
                    breadcrumb.data = {
                        method,
                        url,
                        status_code: statusCode,
                        batch,
                        request: filterData('Request', data.data),
                        response: filterData('Response', funResult.data)
                    };
                }
            } else if (routeApis.indexOf(funName) !== -1) {
                if (!HookNative.historyBreadcrumbs) {
                    return;
                }
                breadcrumb = {}
                breadcrumb.category = 'navigation';
                breadcrumb.level = 'info';
                breadcrumb.type = 'default';
                breadcrumb.message = `${type}/${batch}: ${funName}`;
                const data = {};
                const pages = getCurrentPages() || [];
                const curIndex = pages.length ? pages.length - 1 : 0;
                const fromPage = (pages[curIndex] || { __route__: NOGET });
                data.from = getFullUrl(fromPage);
                if (funName === 'navigateBack') {
                    const index = curIndex - (args[0] || { delta: 1 }).delta;
                    const toPage = (pages[index >= 0 ? index : 0] || { __route__: NOGET })
                    data.to = getFullUrl(toPage);
                } else {
                    data.to = (args[0] || { url: NOGET }).url;
                }
                // TODO: 过滤from和to中的url参数，做敏感数据处理
                breadcrumb.data = data;
            } else if (!HookNative.wxApiBreadcrumbs) {
                return;
            } else {
                breadcrumb = {}
                breadcrumb.category = `${eName}`;
                breadcrumb.level = 'info';
                breadcrumb.type = 'default';
                breadcrumb.message = `${type}/${batch}: ${funName}`;
            }
        } else {
            if (!HookNative[`${lowerName}Breadcrumbs`]) {
                return;
            }
            breadcrumb.level = 'info';
            breadcrumb.type = 'default';
            breadcrumb.category = `${eName}`;
            breadcrumb.message = `${type}/${batch}: ${getEntityKey(ctx, eLabel)} [${funName}]`;
            if (eName === 'Component') {
                breadcrumb.message += ` (in page: ${getEntityKey(getPage(ctx))})`
            }
        }
        if (type === 'after' && funName !== 'request' && routeApis.indexOf(funName) === -1) {
            breadcrumb.data = breadcrumb.data || {};
            breadcrumb.data.arguments = filterData(`${lowerName === 'wx' ? 'wxApi' : lowerName}Arguments`, args);
            breadcrumb.data.result = filterData(`${lowerName === 'wx' ? 'wxApi' : lowerName}`, funResult);
        }
        if (breadcrumb.data) {
            Object.keys(breadcrumb.data).forEach(key => {
                if (breadcrumbInvalidDatas.indexOf(key) !== -1 && breadcrumb.data[key] === false) {
                    delete breadcrumb.data[key]
                }
            })
        }
        Sentry.addBreadcrumb(breadcrumb);
    }
}
const mixinMergeHooks = {
    methodExecBefore: [function (batch, funName, args, ctx) {
        ctx = ctx || this;
        sentryMethod('before', batch, funName, args, null, null, ctx);
    }],
    methodExecAfter: [function (batch, funName, args, funResult, ctx) {
        ctx = ctx || this;
        sentryMethod('after', batch, funName, args, funResult, null, ctx);
    }],
    methodExecError: [function (batch, funName, args, error, ctx) {
        ctx = ctx || this;
        sentryMethod('error', batch, funName, args, null, error, ctx);
    }]
};
const mergeMixin = DefaultMerge(mixinMergeHooks);
Sentry.mergeMixin = mergeMixin;
Sentry.addMixinHook = (type, hooker) => {
    mixinMergeHooks[type] = mixinMergeHooks[type] || [];
    if (mixinMergeHooks[type].indexOf(hooker) === -1) {
        mixinMergeHooks[type].push(hooker);
    }
};
const hookState = {};
const orgApp = App;
const orgPage = Page;
const orgComponent = Component;
[[orgApp, 'App'], [orgPage, 'Page'], [orgComponent, 'Component']].forEach(item => {
    Sentry[`Native${item[1]}`] = item[0];
    Sentry[item[1]] = function (...specList) {
        let finalSpec;
        if (item[1] === 'App') {
            const hookSpec = {};
            if (HookNative.appOnError) {
                hookState.appOnError = true;
                hookSpec.onError = captureAppOnError;
            }
            if (HookNative.appOnPageNotFound) {
                hookSpec.onPageNotFound = captureAppOnPageNotFound;
            }
            // eslint-disable-next-line no-useless-call
            finalSpec = mergeMixin.apply(null, [hookSpec, ...specList]);
        } else if (item[1] === 'Page') {
            finalSpec = mergeMixin.apply(null, specList);
        } else if (item[1] === 'Component') {
            const propsSpec = [];
            const methodsSpec = [];
            const noMethodsMixins = [];
            specList.forEach(item => {
                if (item) {
                    if (item.methods) {
                        methodsSpec.push(item.methods);
                    }
                    if (item.properties) {
                        propsSpec.push(item.properties);
                    }
                    const noMethodsMixin = {};
                    let isChange;
                    Object.keys(item).forEach(key => {
                        if (key !== 'methods' && key !== 'properties') {
                            isChange = true;
                            noMethodsMixin[key] = item[key]
                        }
                    });
                    isChange && noMethodsMixins.push(noMethodsMixin);
                }
            });
            finalSpec = mergeMixin.apply(null, noMethodsMixins);
            const properties = propsSpec.length ? mergeMixin.apply(null, propsSpec) : {};
            Object.assign(finalSpec, {
                properties,
                methods: mergeMixin.apply(null, methodsSpec)
            })
        }
        if (typeof finalSpec.mixinMergeEnd === 'function') {
            finalSpec.mixinMergeEnd(finalSpec);
        }
        return item[0](finalSpec);
    }
});
if (SentryConfig.mixinMergeHooks && SentryConfig.mixinMergeHooks.addMixin) {
    // 外部传入了钩子容器，说明外部有自己的mixin merge规则，只需要将拦截函数传给外部即可
    if (HookNative.App) {
        if (HookNative.appOnError) {
            hookState.appOnError = true;
            SentryConfig.mixinMergeHooks.addMixin('App', {
                onError: captureAppOnError
            });
        }
        if (HookNative.appOnPageNotFound) {
            hookState.appOnPageNotFound = true;
            SentryConfig.mixinMergeHooks.addMixin('App', {
                onPageNotFound: captureAppOnPageNotFound
            });
        }
        hookState.onPageNotFound = true;
    }
    HookNative.App = false;
    HookNative.Page = false;
    HookNative.Component = false;
    HookNative.WxApi = false;
    Object.keys(mixinMergeHooks).forEach(prop => {
        SentryConfig.mixinMergeStrategie[prop] = SentryConfig.mixinMergeStrategie[prop] || [];
        SentryConfig.mixinMergeStrategie[prop].push(mixinMergeHooks[prop]);
        delete mixinMergeHooks[prop];
    })
} else if (HookNative.App || HookNative.Page || HookNative.Component || HookNative.WxApi) {
    // 判断原生对象是否支持重写
    if (supportRewrite(App)) {
        // 覆盖原生对象
        if (HookNative.App) {
            App = Sentry.App;
        }
        if (HookNative.Page) {
            Page = Sentry.Page;
        }
        if (HookNative.Component) {
            Component = Sentry.Component;
        }
        const orgWx = wx;
        orgWx.$id = orgWx.$label = orgWx.$constructorName = 'Wx';
        Sentry.NativeWx = orgWx;
        if (HookNative.WxApi) {
            const rewriteWx = {};
            for (const apiName in orgWx) {
                if (typeof orgWx[apiName] === 'function') {
                    rewriteWx[apiName] = function (...args) {
                        const batch = uuid();
                        try {
                            runHook(mixinMergeHooks, 'methodExecBefore', [batch, apiName, args, orgWx]);
                            if (!isSyncApi(apiName)) {
                                args[0] = args[0] || {};
                                const orgSuccesss = args[0].success;
                                const orgFail = args[0].fail;
                                args[0].success = function (...resArgs) {
                                    runHook(mixinMergeHooks, 'methodExecAfter', [batch, apiName, args, resArgs[0], orgWx]);
                                    return orgSuccesss.apply(null, resArgs);
                                }
                                args[0].fail = function (...resArgs) {
                                    const error = new Error(resArgs[0] && resArgs[0].errMsg ? resArgs[0].errMsg : '未知错误');
                                    error.original = resArgs[0];
                                    runHook(mixinMergeHooks, 'methodExecError', [batch, apiName, args, error, orgWx]);
                                    return orgFail.apply(null, resArgs);
                                }
                            }
                            const result = orgWx[apiName].apply(orgWx, args);
                            return result;
                        } catch (error) {
                            runHook(mixinMergeHooks, 'methodExecError', [batch, apiName, args, error, orgWx]);
                        }
                    }
                } else {
                    rewriteWx[apiName] = orgWx[apiName];
                }
            }
            wx = Sentry.Wx = rewriteWx;
        }
    } else {
        console.warn('小程序相关原生对象及函数无法被重写');
        setTimeout(() => {
            captureException(new Error('小程序相关原生对象及函数无法被重写', null, {
                sysInfo: getSysInfo()
            }))
        });
    }
}

// 重写console对象
if (HookNative.consoleBreadcrumbs || HookNative.consoleAutoCapture) {
    const orgConsole = {};
    Object.keys(console).forEach(prop => {
        orgConsole[prop] = console[prop];
        const orgFunction = console[prop];
        if (HookNative.consoleBreadcrumbs) {
            console[prop] = function () {
                if (arguments[0] && typeof arguments[0] === 'object' && arguments[0].event_id && arguments[0].sdk) {
                } else if (!Array.prototype.some.call(arguments, item => typeof item === 'object' && item && item.useNative)) {
                    // 调用console.xxx时可传入对象，对象的属性中含有useNative的，则跳过面包屑记录和异常监控
                    Sentry.addBreadcrumb({
                        level: prop === 'error' ? 'error' : 'info',
                        category: 'console',
                        message: filterData('consoleArguments', Array.from(arguments)).join(' '),
                        data: {
                            logger: 'console',
                            extra: filterData('consoleArguments', Array.from(arguments))
                        }
                    });
                    if (prop === 'error' && HookNative.consoleAutoCapture) {
                        captureException(arguments);
                    }
                }
                return orgFunction.apply(this, arguments);
            }
        } else if (prop === 'error') {
            console[prop] = function () {
                if (arguments[0] && typeof arguments[0] === 'object' && arguments[0].event_id && arguments[0].sdk) {
                } else {
                    captureException(arguments);
                }
                return orgFunction.apply(this, arguments);
            }
        }
    })
}

// 如果设置计算后app不会进行mixin处理，而又配置了要监控onError/onPageNotFound的错误，则只用wx的api进行监控，前提是wx版本支持
if (HookNative.appOnError && !hookState.appOnError && 'onError' in wx) {
    wx.onError(captureAppOnError);
}
if (HookNative.appOnPageNotFound && !hookState.onPageNotFound && 'onPageNotFound' in wx) {
    wx.onPageNotFound(captureAppOnPageNotFound);
}
Sentry.HookNative = HookNative;

// 将sentry服务挂载到wx上
wx.Sentry = Sentry;
