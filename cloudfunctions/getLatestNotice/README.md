# 云函数部署说明 - getLatestNotice

## 📋 功能说明

获取最新一条已发布的公告，从云数据库 `sys_notice` 表中读取。

## 🚀 部署步骤

### 1. 配置云环境 ID

打开 [app.js](../app.js)，找到第 40 行左右：

```javascript
env: 'cloud1-5g9l8h7b6e2c3d4f', // TODO: 替换为你的云环境 ID
```

将 `'cloud1-5g9l8h7b6e2c3d4f'` 替换为你实际的云环境 ID。

**如何获取云环境 ID：**
1. 打开微信开发者工具
2. 点击顶部菜单栏的「云开发」按钮
3. 在云开发控制台中查看环境 ID

### 2. 上传并部署云函数

#### 方式一：使用微信开发者工具（推荐）

1. 在微信开发者工具中，右键点击 `cloudfunctions/getLatestNotice` 文件夹
2. 选择「上传并部署：云端安装依赖」
3. 等待上传完成

#### 方式二：命令行部署

```bash
cd cloudfunctions/getLatestNotice
npm install
```

然后在微信开发者工具中右键该文件夹 → 「上传并部署：所有文件」

### 3. 确保云数据库权限

在云开发控制台中，设置 `sys_notice` 集合的权限：

**推荐权限设置：**
- **数据权限**：仅创建者可读写（或自定义安全规则）
- **索引**：建议为以下字段添加索引以提升查询性能：
  - `status`（升序）
  - `publish_time`（降序）
  - `created_at`（降序）

**自定义安全规则示例：**

```json
{
  "read": true,
  "write": "doc.status == 'published'"
}
```

### 4. 测试云函数

#### 在开发者工具中测试：

1. 右键 `cloudfunctions/getLatestNotice` → 「本地调试」
2. 或在云开发控制台 → 云函数 → getLatestNotice → 测试

#### 在小程序中测试：

1. 编译运行小程序
2. 进入首页（pages/index/index）
3. 查看是否显示公告内容

##  数据库表结构

### sys_notice 表

| 字段名 | 类型 | 说明 |
|--------|------|------|
| id | String/Number | 主键 |
| title | String | 公告标题 |
| content | String | 公告内容 |
| status | String | 状态：'published'（已发布）、'draft'（草稿）等 |
| publish_time | Date/String | 发布时间 |
| created_by | String | 创建人 |
| created_at | Date/String | 创建时间 |
| updated_at | Date/String | 更新时间 |

## 🔍 查询逻辑

云函数会执行以下查询：

```javascript
db.collection('sys_notice')
  .where({ status: 'published' })           // 只查已发布的公告
  .orderBy('publish_time', 'desc')          // 按发布时间降序
  .orderBy('created_at', 'desc')            // 如果发布时间相同，按创建时间降序
  .limit(1)                                  // 只取第一条
  .get()
```

## 📝 返回格式

成功时返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 1,
    "title": "本周菜单通知",
    "content": "本周生效菜单：菜单 1...",
    "status": "published",
    "publish_time": "2026-06-20 09:00:00",
    "created_by": "管理员老王",
    "created_at": "2026-06-20 09:00:00",
    "updated_at": "2026-06-20 09:00:00"
  }
}
```

无公告时返回：

```json
{
  "code": 0,
  "message": "暂无公告",
  "data": null
}
```

失败时返回：

```json
{
  "code": -1,
  "message": "获取公告失败: xxx",
  "data": null
}
```

## ⚠️ 注意事项

1. **云环境 ID 必须正确**：否则云函数调用会失败
2. **数据库集合名称**：必须是 `sys_notice`（与你的数据库表名一致）
3. **字段名称**：云函数中使用的是下划线命名（如 `publish_time`），与数据库保持一致
4. **权限配置**：确保云函数有读取 `sys_notice` 集合的权限
5. **索引优化**：建议添加复合索引 `(status, publish_time DESC, created_at DESC)` 提升查询性能

##  常见问题

### Q1: 云函数调用失败，提示 "cloud function not found"

**解决方案：**
- 确认云函数已上传并部署
- 检查云环境 ID 是否正确
- 确认云开发服务已开通

### Q2: 返回空数据

**可能原因：**
- 数据库中没有 `status = 'published'` 的记录
- 检查数据库中是否有符合条件的公告

### Q3: 权限错误

**解决方案：**
- 在云开发控制台检查集合权限设置
- 确保云函数有读取权限

## 📞 技术支持

如有问题，请检查：
1. 微信开发者工具控制台是否有报错
2. 云函数日志（云开发控制台 → 云函数 → 日志）
3. 数据库集合是否存在且有数据
