@echo off
chcp 65001 >nul
rem 把 dsh-ops-conventions 源码同步到 DSH 已安装副本
rem 用法：改完 _tools\dsh-ops-conventions 里的文件后双击本脚本，然后去插件页把插件关掉再打开。
set "SRC=%~dp0"
set "DST=C:\Users\TANG\.dsh\profiles\desktop\node_modules\dsh-ops-conventions"

if not exist "%DST%" (
  echo [错误] 找不到已安装副本：%DST%
  pause
  exit /b 1
)

copy /Y "%SRC%index.mjs"      "%DST%\index.mjs"      >nul
copy /Y "%SRC%rule.mjs"       "%DST%\rule.mjs"       >nul
copy /Y "%SRC%cordis.patch.yml" "%DST%\cordis.patch.yml" >nul
copy /Y "%SRC%package.json"   "%DST%\package.json"   >nul

echo 已同步到：%DST%
echo 下一步：DSH 插件页 → 把「dsh-ops-conventions」关掉再打开（热重载，不用重启 harness）。
pause
