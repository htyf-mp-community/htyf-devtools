const os = require('os');
let platform = '';
if (platform === 'darwin') {
  platform = 'mac';
} else if (platform === 'win32') {
  platform = 'win';
}

const DEFAULT_UPDATE_URL = `https://dagouzhi.oss-cn-qingdao.aliyuncs.com/com.dagouzhi.mp.devtools/latest/${platform}`;

function getUpdateUrl(environment = process.env) {
  return (environment.HTYF_DEVTOOLS_UPDATE_URL || DEFAULT_UPDATE_URL).replace(/\/$/, '');
}

module.exports = {DEFAULT_UPDATE_URL, getUpdateUrl};
