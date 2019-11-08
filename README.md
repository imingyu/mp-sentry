# mp-sentry
小程序Sentry SDK

## 使用方式
- 将`src`目录放入你的项目代码中；
- 在`src/config.js`中配置好你的数据；
- 在`app.js`第一行引入`src/install.js`;
- `wx.Sentry`对象与sentry js sdk中的对象一致，用法也一致；
- 更多使用细节参考代码（虽然这很懒，但是此类库确实有效，并保持原有SDK的大部分功能）

## TODO
- ui动作（tap/input等）添加面包屑
- 拦截setTimeout等原生函数
