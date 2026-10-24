@echo off
rem update-all.cmd - install dsh-ops-conventions into every local DSH profile
rem   update-all.cmd            install into desktop + web
rem   update-all.cmd check      print installed versions only
rem   update-all.cmd --pull     git pull --ff-only first, then install
node "%~dp0update-all.mjs" %*
