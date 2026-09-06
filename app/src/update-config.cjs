const DEFAULT_UPDATE_URL = 'https://dagouzhi.oss-cn-qingdao.aliyuncs.com/com.dagouzhi.mp.devtools/latest/';

function getUpdateUrl(environment = process.env) {
  return (environment.HTYF_DEVTOOLS_UPDATE_URL || DEFAULT_UPDATE_URL).replace(/\/$/, '');
}

module.exports = {DEFAULT_UPDATE_URL, getUpdateUrl};
