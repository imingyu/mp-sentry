import { replaceSensitive, repeatReplace, safeJSON } from './util';
export default {
    nogetValue: 'noget', // 某些变量未获取到值时将用此变量值替换
    printError: true, // 当捕获到异常后是否在控制台打印？
    dsn: '',
    environment: 'test', // 环境变量值
    release: '1.0', // 当前小程序版本
    requestHandler: wx.request, // request函数
    simplifyHandler(data, type, subType, target) {
        // 数据简化处理函数
        if (typeof data !== 'object') return data;
        // 将数据安全转化为json，避免过滤敏感数据后对其他方法有影响
        data = safeJSON(data);
        if (typeof data !== 'object') return data;
        return data;
    },
    sensitiveHandler(data) {
        // 敏感数据处理函数，所有计入sentry的object对象都会经过此函数处理
        // 什么？你想处理非object类型的数据？如果你有此需求，框架不为你处理，请自行在 beforeSend 钩子函数中进行处理
        if (typeof data !== 'object') return data;
        // 将数据安全转化为json，避免过滤敏感数据后对其他方法有影响
        data = safeJSON(data);
        if (typeof data !== 'object') return data;
        // 默认只处理一些互联网界较为常见的敏感数据字段，你可以自行在此数组中添加更多字段名
        repeatReplace(data, ['password', 'username', 'user_name', 'mobilePhone', 'mobile_phone'], (obj, key, value) => {
            if (key === 'password' || key.indexOf('password') !== -1) {
                obj[key] = '*';
            } else {
                obj[key] = replaceSensitive(value);
            }
        })
        return data;
    },
    mixinMergeHooks: null, // mixin 合并钩子，之所以本js可以在小程序中进行Sentry监控，就是用了Mixin机制，将传给app/page/component函数的对象进行拦截，自动加入预制的mixin以做到监控，本js库内置了一套mixin合并策略，如果你的程序中也是用了类似技术，可以由此配置项传入，进行你自己的定制；如果传入了，请确保支持以下几个api：见文件底部
    ignoreErrors: [], // 排除异常正则表达式列表，匹配异常message
    breadcrumbs: { // 需要对系统的哪些操作进行面包屑监控？
        console: {
            arguments: 'simplify' // false=不记录，simplify=记录简化后的数据，full=记录完整的数据
        }, // console相关函数执行后需要进行监控
        request: {
            arguments: 'simplify', // false=不记录，simplify=记录简化后的数据，full=记录完整的数据
            result: 'simplify'
        }, // wx.request前后需要进行监控
        history: true, // 监控页面跳转历史
        wxApi: {
            arguments: 'simplify',
            result: 'simplify'
        }, // 是否对wx对象下的相关api执行做监控？
        methods: { // 是否对方法进行监控
            app: {
                arguments: 'simplify',
                result: 'simplify'
            },
            page: {
                arguments: 'simplify',
                result: 'simplify'
            },
            component: {
                arguments: 'simplify',
                result: 'simplify'
            }
        }
    },
    autoCapture: { // 需要对系统的哪些操作进行自动异常捕获？
        appOnError: true, // 捕获app.onError中的异常
        appOnPageNotFound: true, // 捕获app.onPageNotFound 中的异常
        console: true, // 捕获console.error中的异常
        request: {
            arguments: 'simplify', // false=不记录，simplify=记录简化后的数据，full=记录完整的数据
            result: 'simplify'
        }, // 捕获wx.request fail的异常
        wxApi: {
            arguments: 'simplify',
            result: 'simplify'
        }, // 捕获wx对象下的相关api执行后(包括同步执行后和异步执行fail)发生的异常
        methods: { // 捕获方法执行后发生的异常
            app: {
                arguments: 'simplify',
                result: 'simplify'
            },
            page: {
                arguments: 'simplify',
                result: 'simplify'
            },
            component: {
                arguments: 'simplify',
                result: 'simplify'
            }
        }
    }
}

/*
mixinMergeHooks 应该是一个对象，支持以下属性，当你的自定义mixin合并策略执行后，请确保以下钩子函数在对应时机正确执行:

methodExecBefore: 支持传入函数数组，策略将mixin合并后，最终对象中的 function 在执行前将会依次执行methodExecBefore中的函数，并传入 function 的参数和一个代表本次function执行的标志id

methodExecAfter: 支持传入函数数组，策略将mixin合并后，最终对象中的 function 在执行后（如果function执行后返回的是promise，那应该在promise状态确定后，在执行methodExecAfter）将会依次执行methodExecAfter中的函数，并传入 function 的参数以及 function 的结果和一个代表本次function执行的标志id

methodExecError: 支持传入函数数组，策略将mixin合并后，最终对象中的 function 在执行过程中发生异常后（如果function执行后返回的是promise，那应该在promise catch中执行methodExecError），将会依次执行methodExecError中的函数，并传入 function 的参数、异常对象和一个代表本次function执行的标志id

*/
