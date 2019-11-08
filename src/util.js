export const isSyncApi = apiName => apiName.indexOf('Sync') !== -1 || apiName.startsWith('on') || apiName.startsWith('off');
// 解析url 的search部分
export const parseUrlSearch = serach => {
    const arr = serach.split('?');
    return arr[1].split('&').reduce((sum, item) => {
        const ar = item.split('=');
        sum[decodeURIComponent(ar[0])] = decodeURIComponent(ar[1]);
        return sum;
    }, {});
};

export const uuid = () => {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        // tslint:disable-next-line:no-bitwise
        var r = (Math.random() * 16) | 0;
        // tslint:disable-next-line:no-bitwise
        var v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    })
}
export const runHook = (hooks, type, args) => {
    if (hooks && hooks[type]) {
        if (Array.isArray(hooks[type])) {
            hooks[type].forEach(item => {
                if (typeof item === 'function') {
                    item.apply(null, args);
                }
            })
        } else if (typeof hooks[type] === 'function') {
            hooks[type].apply(null, args);
        }
    }
}

export const supportRewrite = obj => {
    const org = obj;
    try {
        obj = 1;
        if (obj === 1) {
            obj = org;
            return true;
        }
    } catch (error) {
    }
    obj = org;
    return false;
}

let CONTEXTS;
let SYS_INFO;
export const getSysInfo = (defaultVal) => {
    if (SYS_INFO) {
        return SYS_INFO;
    }
    try {
        SYS_INFO = wx.getSystemInfoSync();
        return SYS_INFO;
    } catch (error) {
    }
    return defaultVal;
}
export const getSentryContexts = (NOGET) => {
    if (!CONTEXTS) {
        const sysInfo = getSysInfo();
        if (sysInfo) {
            CONTEXTS = {
                browser: {
                    version: SYS_INFO.version,
                    name: 'Wechat'
                },
                os: {
                    version: SYS_INFO.system,
                    name: SYS_INFO.platform
                },
                device: {
                    model: SYS_INFO.model,
                    brand: SYS_INFO.brand,
                    family: SYS_INFO.model
                }
            };
        }
    }
    if (!CONTEXTS) {
        return {
            browser: {
                version: NOGET,
                name: 'Wechat'
            },
            os: {
                version: NOGET,
                name: NOGET
            },
            device: {
                model: NOGET,
                brand: NOGET,
                family: NOGET
            }
        };
    }
    return CONTEXTS;
}

export const getEntityName = (vm, defaultVal) => {
    if (!vm) {
        return ''
    }
    if (vm.$constructorName) {
        return vm.$constructorName;
    }
    if (vm.route || vm.__route__) {
        return 'Page'
    }
    if (vm.is) {
        return 'Component';
    }
    if (vm) {
        return 'App';
    }
    return defaultVal;
}

export const getEntityLabel = (vm, defaultVal) => {
    if (vm.$label) {
        return vm.$label;
    }
    if (vm.route || vm.__route__) {
        return vm.route || vm.__route__
    }
    if (vm.is) {
        return vm.is;
    }
    if (vm) {
        return 'App';
    }
    return defaultVal;
}

export const getEntityId = (vm, defaultVal) => {
    if (vm.$id) {
        return vm.$id;
    }
    if ('__wxWebviewId__' in vm) {
        // page
        return vm.__wxWebviewId__;
    }
    if ('__wxExparserNodeId__' in vm) {
        // component
        return vm.__wxExparserNodeId__
    }
    if (vm) {
        return 'App';
    }
    return defaultVal;
}

const getPageId = (vm) => {
    if (vm && vm.__wxWebviewId__) {
        return vm.__wxWebviewId__;
    }
}

export const getPage = (componentVm, defaultVal) => {
    if (componentVm && componentVm.$page) {
        return componentVm.$page;
    }
    const pageId = getPageId(componentVm);
    if (pageId) {
        const pages = getCurrentPages();
        if (pages && pages.length) {
            const page = pages.find(item => item.__wxWebviewId__ === pageId);
            if (page) {
                return page;
            }
        }
    }
    return defaultVal;
}

export const concatParams = (obj, encode) => {
    const result = [];
    for (const prop in obj) {
        if (encode) {
            result.push(encodeURIComponent(prop) + '=' + encodeURIComponent(obj[prop]))
        } else {
            result.push(prop + '=' + obj[prop]);
        }
    }
    return result.join('&');
}

export const getFullUrl = pageVm => {
    const route = pageVm.__route__ || pageVm.route || pageVm.is;
    return route + `${pageVm.options ? ('?' + concatParams(pageVm.options)) : ''}`
}

export const isMobilePhone = phone => {
    return /^1[345789]\d{9}$/.test(phone);
};

export const repeatReplace = (obj, key, handler) => {
    if (typeof obj === 'object' && obj) {
        for (const prop in obj) {
            if (Array.isArray(key) && key.indexOf(prop) !== -1) {
                handler && handler(obj, prop, obj[prop]);
            } else if (prop === key || prop.indexOf(key) !== -1 || prop.toLowerCase().indexOf(key) !== -1) {
                handler && handler(obj, prop, obj[prop]);
            }
            if (typeof obj[prop] === 'object' && obj[prop]) {
                repeatReplace(obj[prop], key, handler);
            }
        }
    }
};

export const replaceSensitive = (str, hideCount = 'auto', direction = 'center', char = '*') => {
    if (!str || !str.trim()) {
        return str;
    }
    str = String.prototype.toString.call(str);
    const list = str.split('');
    if (isMobilePhone(str) && hideCount === 'auto') {
        str = list
            .splice(3, 4)
            .fill(char)
            .join('');
        list.splice(3, 0, str);
        return list.join('');
    }
    const len = str.length;
    let repeat = 1;
    if (len > 10) {
        repeat = 3;
    } else if (len > 3) {
        repeat = 2;
    }
    if (typeof hideCount !== 'number') {
        const arr = [];
        let j = 0;
        let i = direction === 'begin' ? 0 : len;
        while (true) {
            const temp = list.slice(
                direction === 'begin' ? i : i - repeat <= 0 ? 0 : i - repeat,
                direction === 'begin' ? i + repeat : i
            );
            if (j % 2 === 0) {
                temp.fill(char);
            }
            arr.push(temp.join(''));
            j++;
            if (direction === 'begin') {
                i += repeat;
                if (i >= len) {
                    break;
                }
            } else {
                i -= repeat;
                if (i <= 0) {
                    break;
                }
            }
        }
        if (direction !== 'begin') {
            arr.reverse();
        }
        return arr.join('');
    } else {
        if (hideCount > len) {
            return list.fill(char).join('');
        }
        if (direction === 'begin') {
            str = list
                .splice(0, hideCount)
                .fill(char)
                .join('');
            return str + list.join('');
        } else if (direction === 'end') {
            str = list
                .splice(len - hideCount, hideCount)
                .fill(char)
                .join('');
            return list.join('') + str;
        } else {
            const ci = len / 2;
            const ti = hideCount / 2;
            let begin = Math.floor(ci - ti);
            begin = begin < 0 ? 0 : begin;
            str = list
                .splice(begin, hideCount)
                .fill(char)
                .join('');
            list.splice(begin, 0, str);
            return list.join('');
        }
    }
};

export const safeJSON = obj => {
    let val;
    const name = getEntityName(obj);
    if (name && name !== 'App') {
        if ('toJSON' in obj) {
            val = obj.toJSON();
            return val;
        }
        return `{${getEntityId(obj)}}${name}:${getEntityLabel(obj)}`;
    } else {
        val = JSON.stringify(obj);
    }
    return typeof val === 'undefined' ? val : JSON.parse(val);
}
