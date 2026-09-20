# 学生在校表现记录平台 · 部署指南

> ## 🆕 v9 版本更新（等级头像 + 试卷拍照）必读
> 已上线的老用户，只需做两件事：
> 1. **跑数据库脚本**：Supabase → SQL Editor → 粘贴运行 `database/08-level-exam.sql` 全部内容（可重复执行）。跑完到左侧 **Storage** 菜单确认出现名为 `exam-papers` 的存储桶（没出现就点 "New bucket"，名字填 `exam-papers`，设为 Public bucket）。
> 2. **覆盖上传代码**：本次新增了两个目录 `assets/avatars/`（24 个头像）和 `js/vendor/tesseract/`（约 20MB 离线识分库）。在 GitHub 仓库点 Add file → Upload files，把解压文件夹里的**全部内容（含这两个新目录）**拖进去，Commit。约 1–2 分钟后用 `?v=9` 强刷页面。
>
> 本次新功能：24 个校园风头像（3 级解锁）、经验/升级（每记录 1 个积极表现 +2 经验）、表情头像每天限换 2 次、打星改为选填（但至少要选一个表现）、教师端"试卷拍照"自动识别分数（仅家长可见，学生端没有入口）。
>
> 全新部署的用户直接跑 `database/01-schema-rls.sql`（已含全部最新结构），无需再按顺序跑 02–08。

纯静态网站（HTML/CSS/JS）+ Supabase 免费版数据库，部署在 Vercel。
三个页面：学生星光墙/自评（`index.html`）、家长查询（`parent.html`）、教师后台（`teacher.html`）。

> 全程使用免费套餐，无需自己的服务器，也不需要信用卡。顺利的话 20–30 分钟可完成。

---

## 目录

0. 开始前准备
1. 创建 Supabase 项目
2. 建表、RLS 权限、函数（运行 SQL）
3. 关闭公开注册，创建老师账号
4. 获取网站连接密钥（URL + anon key）
5. 填写配置文件 `js/config.js`
6. 部署到 Vercel
7. 上线后完整走查
8. 生成家长查询链接与二维码
9. 免费版注意事项、常见问题、安全提醒

附：项目文件结构

---

## 0. 开始前准备

- 一个常用邮箱（注册 Supabase 和 Vercel；两个网站都支持"用 GitHub 账号登录"）
- 建议注册一个免费 **GitHub** 账号（Vercel 用它部署最省心；没有也没关系，第 6 步提供命令行方式）
- 已解压的本项目源码文件夹（解压后里面应直接看到 `index.html`、`css`、`js`、`database` 等）

---

## 1. 创建 Supabase 项目（数据库）

1. 打开 <https://supabase.com>，点 **Start your project**，用 GitHub 或邮箱注册登录。
2. 点 **New project**（首次可能要求先创建一个 Organization，名字随意，如 `school`）。
3. 按提示填写：
   - **Name**：`student-performance`（随意）
   - **Database Password**：点 **Generate a password** 自动生成，**把密码存到备忘录**（本项目基本用不到它，但要留底）
   - **Region**：选离中国最近的，如 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**
     - ⚠️ 区域创建后**不可更改**，一次选好
   - **Pricing Plan**：**Free**
4. 点 **Create new project**，等待约 1–2 分钟初始化完成。

---

## 2. 建表、RLS 权限、函数（运行 SQL）

1. 在 Supabase 项目左侧菜单点 **SQL Editor** → **New query**。
2. 用记事本打开源码里的数据库脚本：
   - **第一次部署（数据库是空的）**：打开 `database/01-schema-rls.sql`
   - **以前已经跑过旧版脚本（已有 3 张表，现在要加星光墙）**：改跑 `database/02-add-student-wall.sql`
3. **全选**脚本内容（Ctrl/Cmd+A）→ 复制 → 粘贴到 Supabase 的 SQL 输入框 → 点 **Run**（或 Ctrl/Cmd+Enter）。
4. 看到 **Success. No rows returned** 即为成功。

**核对结果**：

- 左侧 **Table Editor** 里能看到三张表：`student_info`、`daily_record`、`behavior_tags`
- 其中 `behavior_tags` 表里已有 8 条默认标签（认真听讲、优秀数学作业……）
- 左侧 **Database** → **Views**（或在 SQL Editor 执行下面语句）能看到 `student_directory` 视图

可选验证（SQL Editor 里逐条运行，不报错即可）：

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
select tablename, policyname, cmd from pg_policies where schemaname = 'public';
select * from public.student_directory limit 3;
```

> 脚本可以重复执行，不会产生重复数据（默认标签用了 `on conflict do nothing`）。

---

## 3. 关闭公开注册，创建老师账号

学生和家长**都不需要账号**，只有老师需要登录后台。为防止陌生人注册成"老师"，先关掉公开注册：

1. 左侧 **Authentication** → **Sign In / Providers**（或 **Settings**）。
2. 找到 **Email** 登录方式，确认是**开启**状态。
3. 在 Authentication 设置里找到 **User Signups / Allow new users to sign up**（"允许用户自助注册"），**关闭**它并保存。
   - 不同版本界面文案可能是 "Enable email signups" 开关，关掉即可。

然后手动创建老师账号：

1. 左侧 **Authentication** → **Users** → **Add user** → **Create new user**。
2. 填写：
   - **Email**：老师的邮箱
   - **Password**：给老师设置一个登录密码（转告老师，可让老师登录后自行修改）
   - ✅ **勾选 Auto Confirm User**（**很重要**，否则老师没点确认邮件无法登录）
3. 点 **Create user**。
4. 有多位老师就重复添加。本项目中"所有能登录的用户 = 老师"，都拥有后台全部权限。

---

## 4. 获取网站连接密钥（URL + anon key）

1. 左下角点 **齿轮图标（Project Settings）** → **API**（新版可能叫 **Data API / API Keys**）。
2. 记下两项：
   - **Project URL**：形如 `https://abcdefgh.supabase.co`
   - **anon / public** 密钥（新版界面可能叫 **Publishable key**，以 `sb_publishable_...` 开头，同样可用，复制整串）
3. ⚠️ **只复制 anon（public）这一个**。另一个 `service_role` 密钥会绕过所有权限，**绝对不能**放进网页代码。

> anon 密钥本来就是设计给前端公开使用的，数据安全由已经配置好的 RLS 行级策略保障，可以放心写在网页里。

---

## 5. 填写配置文件 `js/config.js`

1. 在解压的源码里找到 `js/config.js`，用记事本（推荐 VS Code）打开。
2. 把上一步的两项填进去（注意保留引号）：

```js
window.SUPABASE_CONFIG = {
  url: 'https://abcdefgh.supabase.co',
  anonKey: '粘贴你的 anon public 密钥'
};
```

3. 保存文件。整个项目**只有这一个文件需要修改**。

---

## 6. 部署到 Vercel

纯静态网站，Vercel 无需任何构建配置。二选一：

### 方式 A：通过 GitHub（推荐，以后改东西自动更新）

1. 登录 <https://github.com>，右上角 **+** → **New repository**：
   - Repository name：`student-performance`
   - 选 **Private** 或 **Public** 都行
   - 不要勾选 "Add a README"，点 **Create repository**
2. 在新仓库页点 **uploading an existing file**（或 **Add file** → **Upload files**）。
3. 打开解压后的源码文件夹，把里面的 **`index.html`、`parent.html`、`teacher.html`、`css`、`js`、`database`** 全部拖进去
   - ⚠️ 要让 `index.html` 位于仓库**最外层根目录**，不要在外面再套一层文件夹
4. 点页面底部 **Commit changes**。
5. 打开 <https://vercel.com>，点 **Sign Up**（用 GitHub 账号登录最顺，按提示授权）。
6. 点 **Add New…** → **Project** → 在仓库列表找到 `student-performance` → **Import**。
7. 配置页**全部保持默认**即可（Framework Preset 显示 Other，Build / Output 留空），直接点 **Deploy**。
8. 约 1 分钟后出现庆祝动画，点图片/链接即可打开，得到正式网址，形如：
   `https://student-performance-xxxx.vercel.app`

> 以后只要在 GitHub 上修改/上传文件，Vercel 会自动重新部署，无需任何操作。

### 方式 B：用命令行上传（不想注册 GitHub 时）

1. 先安装 Node.js：<https://nodejs.org>（选 LTS 版本，一路下一步）。
2. 在电脑终端（Windows 用 PowerShell）执行：

```bash
npm i -g vercel
```

3. 进入到 **`index.html` 所在的文件夹**，执行：

```bash
vercel login        # 按提示用邮箱完成登录
vercel              # 首次部署到预览环境，所有提问直接回车即可
vercel --prod       # 发布为正式网站，结束后会给出正式网址
```

---

## 7. 上线后完整走查（建议用手机做一遍）

用第 6 步得到的网址：

| 角色 | 打开 | 检查 |
| --- | --- | --- |
| 老师 | `https://你的域名/teacher.html` | 用第 3 步邮箱密码登录成功 |
| 学生 | `https://你的域名/` | 能打开"星光墙"（名单为空时会提示先录入） |
| 家长 | `https://你的域名/parent.html` | 能打开查询表单 |

然后按顺序跑通业务：

1. 老师后台 → **学生名单** → 录入 1–2 个测试学生（班级、学生姓名、家长姓名）。
2. 老师后台 → **表现标签** → 看到默认标签，可自行增加，如"优秀数学作业（勾选型）""今日背诵了什么古诗（填写型）"。
3. 手机打开**学生页** → 选择班级 → 头像墙出现同学 → 点底部 **记录我今天的表现** → 选星星/表情/标签 → 提交，出现撒花动画。
4. 老师后台 → **表现记录** → 能看到刚提交的记录，给它写一条教师评语并保存。
5. 再回学生页 → 点自己/同学头像，能看到星级、标签、评语。
6. 打开**家长页** → 输入班级、学生姓名、家长姓名 → 查询，能看到全部历史记录；故意输错家长姓名，应提示"信息不匹配"。

全部通过即部署成功。

---

## 8. 生成家长查询链接与二维码

**途径一（最方便）：** 老师后台 → **学生名单** → 每个学生右侧点 🔗 图标，会在新标签页打开家长页并**自动弹出该生的二维码**，截图保存发家长群即可；也可点"复制链接"。

**途径二：** 直接打开 `https://你的域名/parent.html`，拉到底部点 **老师点这里：生成查询二维码 / 复制查询链接**，填班级和学生姓名。

链接的样子：

```
https://你的域名/parent.html?class=三年级2班&student=李小明
```

- 链接和二维码里**只有班级和学生姓名**，家长打开后还必须现场输入**家长姓名**才能查看（家长姓名相当于查询口令）。
- 老师用**私聊或家长会**的方式把"家长姓名"告知家长本人，**不要**把家长姓名写在二维码旁边或大群公告里。

---

## 9. 免费版注意事项、常见问题

### 免费版限制

- Supabase 免费项目如果**连续约 7 天完全没有人访问**会被自动暂停（Pause）。
  - 恢复方法：打开任意一次网站页面，或老师登录一次 Supabase 控制台，项目会自动唤醒（首次可能要等 30–60 秒，页面稍后刷新即可）。
- 免费额度（500 MB 数据库、约 5 万月活、5 GB 流量）对班级/年级场景完全够用。
- Vercel 免费版对个人静态网站流量充足，且自动提供 HTTPS。

### 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 页面一直显示"系统还没有连接数据库（Supabase 未配置）" | `js/config.js` 没填或没保存/没重新部署；检查 URL、anonKey 是否粘贴完整（含引号），重新 Commit/部署后强刷浏览器 |
| 学生提交提示"没有找到你的名字" | 班级或姓名与名单**不完全一致**（错字、多空格、班级写法不同）。班级必须和老师录入的一模一样 |
| 老师登录提示失败 / email not confirmed | 建号时没勾 Auto Confirm User。去 Authentication → Users 确认该邮箱状态为 confirmed，或删掉重建 |
| 家长查询提示信息不匹配 | 班级、学生姓名、家长姓名三项任一不一致都会查不到（系统不提示具体是哪项），逐项核对 |
| 改了代码网站没变 | GitHub 是否已 Commit、Vercel 的 Deployments 是否部署完成；手机浏览器可清缓存或用无痕窗口打开 |
| 网址里中文变成了 `%E4%B8%89...` | 正常的网址编码，扫码和打开不受影响 |
| 担心数据丢失 | 可在 Table Editor 里对每张表用 **Export / Download CSV** 定期导出名单和记录 |

### 安全提醒

- `js/config.js` 里只放 **anon public** 密钥；**service_role 密钥永远不要放进网站**。
- 本平台只收集班级、姓名（建议用学生日常称呼）和在校表现，**不收集**身份证号、手机号、住址等敏感信息。
- 按当前设计，拿到学生网址的人可以浏览**全班的姓名和表现记录**（看不到家长姓名，也进不了家长详情）。如果希望给星光墙也加一道"班级口令"，可以在现有基础上扩展。

---

## 附：项目文件结构

```
student-performance-platform/
├── index.html                 学生端：班级星光墙 + 自评提交
├── parent.html                家长端：三项匹配查询 + 二维码
├── teacher.html               教师后台：记录评语 / 名单 / 标签
├── css/                       公共与三端样式（已做手机适配）
├── js/
│   ├── config.js              ★ 唯一需要填写密钥的文件
│   ├── student.js
│   ├── parent.js
│   ├── teacher.js
│   └── vendor/                随站部署的 Supabase SDK 与二维码库（不依赖外部 CDN）
└── database/
    ├── 01-schema-rls.sql      全新部署：建表 + 视图 + RLS + 函数
    └── 02-add-student-wall.sql 旧库增量：新增星光墙只读视图与权限
```
