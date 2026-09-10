let state;
function createValueField(key, value, history) {
  const field = document.createElement('div'); field.className = 'value-field';
  const input = document.createElement('input'); input.type = 'text'; input.value = value.trim(); input.dataset.key = key;
  input.setAttribute('aria-label', `${key} 的值`);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.autocomplete = 'off';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'history-toggle'; toggle.textContent = '▾'; toggle.setAttribute('aria-label', `选择 ${key} 的历史值`);
  const list = document.createElement('div'); list.className = 'history-list'; list.id = `history-${key}`; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', `${key} 的历史值`); list.hidden = true;
  input.setAttribute('aria-controls', list.id); toggle.setAttribute('aria-controls', list.id);
  const values = [...new Set(history.map(item => item.trim()))];
  let matches = []; let active = -1;
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function choose(index) { input.value = matches[index]; input.focus(); close(); }
  function show(all = false) {
    const query = input.value.trim().toLowerCase();
    matches = values.filter(item => all || item.toLowerCase().includes(query)); active = -1;
    input.removeAttribute('aria-activedescendant'); list.replaceChildren();
    matches.forEach((item, index) => {
      const option = document.createElement('div'); option.className = 'history-option'; option.id = `${list.id}-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.textContent = item || '（空字符串）';
      option.onmousedown = event => event.preventDefault(); option.onclick = () => choose(index); list.append(option);
    });
    if (!matches.length) { const empty = document.createElement('div'); empty.className = 'history-empty'; empty.textContent = values.length ? '无匹配历史，可直接输入新值' : '暂无历史，保存后会记录'; list.append(empty); }
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  input.onfocus = () => show(); input.oninput = () => show();
  input.onblur = () => { input.value = input.value.trim(); };
  field.addEventListener('focusout', event => { if (!field.contains(event.relatedTarget)) close(); });
  toggle.onmousedown = event => event.preventDefault();
  toggle.onclick = () => { const wasOpen = !list.hidden; input.focus(); if (wasOpen) close(); else show(true); };
  input.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (list.hidden) show(true);
      if (!matches.length) return;
      active = active < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      [...list.children].forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
      input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({block: 'nearest'});
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) { event.preventDefault(); choose(active); }
    else if (event.key === 'Tab') close();
  };
  field.append(input, toggle, list);
  return field;
}
async function load() {
  state = await window.devtoolsHost.getEnvironment();
  const rows = document.querySelector('#rows'); rows.replaceChildren();
  for (const variable of state.variables) {
    const {key, description} = variable;
    const item = state.values[key];
    const row = document.createElement('div'); row.className = 'row';
    const name = document.createElement('span');
    const code = document.createElement('code'); code.textContent = key;
    const detail = document.createElement('small'); detail.textContent = description;
    name.append(code, document.createElement('br'), detail);
    const field = createValueField(key, item.value, state.history?.[key] || []);
    row.append(name, field);
    if (variable.custom) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-variable'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除 ${key}`);
      remove.onclick = async () => {
        remove.disabled = true;
        try {
          const result = await window.devtoolsHost.deleteEnvironmentVariable(key);
          if (!result) return;
          row.remove();
          document.querySelector('#status').textContent = `已删除 ${key}，历史值已保留，请重启目标应用。`;
        } catch (error) {
          document.querySelector('#status').textContent = `删除失败：${error.message}`;
        } finally {
          remove.disabled = false;
        }
      };
      row.append(remove);
    }
    rows.append(row);
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
    valueInput?.focus();
    document.querySelector('#status').textContent = `已添加 ${key}，填写值后请点击“保存到系统”。`;
  } catch (error) { document.querySelector('#status').textContent = `添加失败：${error.message}`; }
};
document.querySelector('#save').onclick = async () => {
  const values = {};
  for (const row of document.querySelectorAll('.row')) { const input = row.querySelector('input[type=text]'); input.value = input.value.trim(); values[input.dataset.key] = input.value; }
  document.querySelector('#status').textContent = '正在写入…';
  try { await window.devtoolsHost.setEnvironment(values); await load(); document.querySelector('#status').textContent = '已保存，请重启目标应用。'; }
  catch (error) { document.querySelector('#status').textContent = `保存失败：${error.message}`; }
};
void load();
