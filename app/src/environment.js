let state;
async function load() {
  state = await window.devtoolsHost.getEnvironment();
  const rows = document.querySelector('#rows'); rows.replaceChildren();
  for (const variable of state.variables) {
    const {key, description} = variable;
    const item = state.values[key];
    const row = document.createElement('label'); row.className = 'row';
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = item.exists;
    const name = document.createElement('span');
    const code = document.createElement('code'); code.textContent = key;
    const detail = document.createElement('small'); detail.textContent = description;
    name.append(code, document.createElement('br'), detail);
    const input = document.createElement('input'); input.type = 'text'; input.value = item.value; input.dataset.key = key; input.disabled = !enabled.checked;
    enabled.onchange = () => { input.disabled = !enabled.checked; };
    row.append(enabled, name, input); rows.append(row);
  }
}
document.querySelector('#refresh').onclick = () => void load();
const addForm = document.querySelector('#add-form');
document.querySelector('#add').onclick = () => { addForm.classList.add('visible'); document.querySelector('#new-key').focus(); };
document.querySelector('#cancel-add').onclick = () => addForm.classList.remove('visible');
document.querySelector('#confirm-add').onclick = async () => {
  const keyInput = document.querySelector('#new-key');
  const descriptionInput = document.querySelector('#new-description');
  const key = keyInput.value.trim().toUpperCase();
  document.querySelector('#status').textContent = '正在添加…';
  try {
    await window.devtoolsHost.addEnvironmentVariable({key, description: descriptionInput.value});
    keyInput.value = ''; descriptionInput.value = ''; addForm.classList.remove('visible');
    await load();
    const valueInput = [...document.querySelectorAll('input[data-key]')].find(input => input.dataset.key === key);
    if (valueInput) {
      const checkbox = valueInput.closest('.row').querySelector('input[type=checkbox]');
      checkbox.checked = true; valueInput.disabled = false; valueInput.focus();
    }
    document.querySelector('#status').textContent = `已添加 ${key}，填写值后请点击“保存到系统”。`;
  } catch (error) { document.querySelector('#status').textContent = `添加失败：${error.message}`; }
};
document.querySelector('#save').onclick = async () => {
  const values = {};
  for (const row of document.querySelectorAll('.row')) { const input = row.querySelector('input[type=text]'); values[input.dataset.key] = row.querySelector('input[type=checkbox]').checked ? input.value : null; }
  document.querySelector('#status').textContent = '正在写入…';
  try { await window.devtoolsHost.setEnvironment(values); await load(); document.querySelector('#status').textContent = '已保存，请重启目标应用。'; }
  catch (error) { document.querySelector('#status').textContent = `保存失败：${error.message}`; }
};
void load();
