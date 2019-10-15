import { uuid, runHook } from './util';
export default (hooks) => {
    const baseTypes = ['string', 'boolean', 'undefined', 'number'];
    const baseTypes2 = ['RegExp', 'Array', 'Set', 'Map', 'Date'].map(item => `[object ${item}]`);
    const toString = Object.prototype.toString;
    const funToString = fun => (typeof fun === 'function' && fun.toString ? fun.toString() : toString.call(fun));

    const execHook = (type, ...args) => {
        return runHook(hooks, type, args);
    }
    /**
     * 合并配置对象，规则：
     * 合并直接的对象存在相同属性名时
     *      后面对象的属性值会覆盖前面的
     *      数据类型是简单类型（string/boolean/number）时后面的对象属性值覆盖前面对象的相应属性值
     *      数据类型是object类型时继续merge
     *      数据类型是function时，会在合并的结果上建立一个同名字的函数，但是会执行所有的函数
     */
    const merge = (...spec) => {
        const result = {};
        const funcs = {};
        const mergeItem = (prop, value, target) => {
            const type = typeof value;
            if (funToString(value).indexOf('[native code]') >= 0) {
                target[prop] = value;
                return;
            }
            if (type === 'function' || value instanceof Function) {
                funcs[prop] = funcs[prop] || [];
                funcs[prop].push(value);
                return;
            }
            // 后面对象传递的属性是非函数型的，坚持funcs中是否已经有其他对象的属性，有责删除，因为后面传递的优先级高于前面的
            if (prop in funcs) {
                delete funcs[prop];
            }
            if (baseTypes.indexOf(type) !== -1) {
                target[prop] = value;
            } else if (type === 'object') {
                if (Array.isArray(value) || value === null || baseTypes2.indexOf(toString.call(value)) >= 0) {
                    target[prop] = value;
                } else if (typeof target[prop] === 'object') {
                    target[prop] = merge(hooks, target[prop], value);
                } else {
                    target[prop] = merge(hooks, value);
                }
            }
        };
        spec.forEach(arg => {
            if (!arg) return;
            for (const prop in arg) {
                mergeItem(prop, arg[prop], result);
            }
        });
        Object.keys(funcs).forEach(funName => {
            result[funName] = function (...args) {
                const ctx = this;
                const batch = uuid();
                const len = funcs[funName].length;
                execHook('methodExecBefore', batch, funName, args, ctx, len);
                const resultList = [];
                let funcResult;
                try {
                    const arr = funcs[funName];
                    for (let index = 0; index < len; index++) {
                        const item = arr[index];
                        let curResult
                        try {
                            curResult = item.apply(ctx, args);
                            resultList.push(curResult);
                            funcResult = curResult;
                        } catch (error) {
                            execHook('methodExecError', batch, funName, args, error, ctx, len, index, curResult, resultList);
                        }
                    }
                    if (typeof funcResult === 'object' && funcResult && funcResult.then) {
                        const promise = funcResult;
                        funcResult = new Promise((resolve, reject) => {
                            promise.then(res => {
                                resultList.push(res);
                                execHook('methodExecAfter', batch, funName, args, res, ctx, len);
                                resolve(res);
                            });
                            promise.catch(err => {
                                execHook('methodExecError', batch, funName, args, err, ctx, len, -1, null, resultList);
                                reject(err);
                            });
                        })
                    } else {
                        execHook('methodExecAfter', batch, funName, args, funcResult, ctx, len);
                    }
                } catch (error) {
                    execHook('methodExecError', batch, funName, args, error, ctx, len, -1, null, resultList);
                }
                return funcResult;
            };
            result[funName].displayName = funName;
        });
        return result;
    };
    return merge;
}
