const data = JSON.parse(document.getElementById('site-data').textContent);
const repo = data.repository;
document.querySelectorAll('[data-details]').forEach(button => { button.hidden = false; });

const guides = {
  start: {
    title: '下载安装，启动第一个桌宠。',
    steps: ['下载 Windows 安装版并完成安装；也可以直接运行免安装版。', '启动后会显示内置阿米娅。左键拖动调整位置，短按互动，右键打开菜单。', '右键桌宠 → 角色管理器，在角色库切换角色；点击「设置」调整大小和语音。'],
    tip: '关闭管理器不会退出桌宠。要隐藏或退出，请使用桌宠或系统托盘的右键菜单。',
    image: 'library.png', alt: '角色库与独立参数设置栏',
  },
  character: {
    title: '添加喜欢的干员和原声语音。',
    steps: ['打开「导入角色 → 搜索角色模型与语音」，输入角色名或模型编号；可筛选基建小人、动态立绘或敌人战斗模型。', '下载模型，再选择可用语种并下载语音。确认角色 ID 与中文字幕匹配后，预览并试听。', '点击「导入并设为当前桌宠」。本地已有模型与语音，也可直接选择文件夹导入。'],
    tip: '本地素材需兼容 Spine 3.8，骨骼、图集和贴图放在同一完整文件夹中；素材入口和教程就在导入页顶部。',
    image: 'materials.png', alt: '导入角色页：素材教程、模型与语音检索入口',
  },
  plugin: {
    title: '下载插件，导入后完成设置。',
    steps: ['在下方插件社区找到需要的插件，先查看使用条件和权限，再下载 ZIP。', '进入「角色管理器 → 扩展 → 导入插件 ZIP」，核对信息后安装，不用解压。', '在扩展页填写城市、连接或 API 配置，然后悬停桌宠打开对应功能。'],
    tip: '插件有自己的版本。在「更新与开发」中检查已收录插件的更新，或重新导入同 ID 的新 ZIP，保留配置和数据。',
    image: 'plugins.png', alt: '扩展管理页：ZIP 导入、插件启用与设置',
  },
};

function setupTabs(selector, activate) {
  const tabs = [...document.querySelectorAll(selector)];
  const updateOrientation = () => tabs[0].parentElement.setAttribute('aria-orientation', getComputedStyle(tabs[0].parentElement).flexDirection === 'column' ? 'vertical' : 'horizontal');
  updateOrientation();
  window.addEventListener('resize', updateOrientation);
  function select(tab, moveFocus = false) {
    for (const candidate of tabs) {
      candidate.setAttribute('aria-selected', String(candidate === tab));
      candidate.tabIndex = candidate === tab ? 0 : -1;
    }
    activate(tab);
    if (moveFocus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const vertical = getComputedStyle(tab.parentElement).flexDirection === 'column';
      const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
      const next = vertical ? 'ArrowDown' : 'ArrowRight';
      let target;
      if (event.key === previous) target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === next) target = (index + 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target !== undefined) { event.preventDefault(); select(tabs[target], true); }
    });
  });
}

function renderGuide(tab) {
  const guide = guides[tab.dataset.guide];
  document.getElementById('guide-subtitle').textContent = guide.title;
  document.getElementById('guide-steps').replaceChildren(...guide.steps.map(text => {
    const item = document.createElement('li');
    const keys = ['右键桌宠 → 角色管理器', '左键拖动', '导入并设为当前桌宠', '导入插件 ZIP', '搜索角色模型与语音', '角色管理器', '不用解压', '导入角色', '扩展', '设置'];
    const pattern = new RegExp(`(${keys.join('|')})`, 'g');
    for (const part of text.split(pattern)) {
      if (keys.includes(part)) { const strong = document.createElement('strong'); strong.className = 'action-highlight'; strong.textContent = part; item.append(strong); }
      else item.append(document.createTextNode(part));
    }
    if (text.includes('右键桌宠')) item.classList.add('key-step');
    return item;
  }));
  document.getElementById('guide-tip').textContent = guide.tip;
  const image = document.getElementById('guide-image');
  image.src = `assets/${guide.image}`;
  image.alt = guide.alt;
  document.getElementById('guide-image-link').href = image.src;
  document.getElementById('guide-panel').setAttribute('aria-labelledby', tab.id);
}
setupTabs('[data-guide]', renderGuide);
renderGuide(document.querySelector('[data-guide=start]'));

let selectedCategory = '全部';
const search = document.getElementById('plugin-search');
const cards = [...document.querySelectorAll('[data-plugin]')];
const filters = [...document.querySelectorAll('[data-category]')];
function filterPlugins() {
  const query = search.value.trim().toLocaleLowerCase();
  let count = 0;
  for (const card of cards) {
    const plugin = data.plugins.find(item => item.id === card.dataset.plugin);
    const haystack = [plugin.name, plugin.description, plugin.author, plugin.category, plugin.id].join(' ').toLocaleLowerCase();
    const visible = (selectedCategory === '全部' || selectedCategory === plugin.category) && haystack.includes(query);
    card.hidden = !visible;
    if (visible) count++;
  }
  document.getElementById('plugin-count').textContent = query || selectedCategory !== '全部' ? `找到 ${count} 个插件` : `${count} 个已收录插件`;
  document.getElementById('empty-state').hidden = count > 0;
  document.getElementById('contribute-card').hidden = query !== '' || selectedCategory !== '全部';
}
filters.forEach(button => button.addEventListener('click', () => {
  selectedCategory = button.dataset.category;
  filters.forEach(item => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  filterPlugins();
}));
search.addEventListener('input', filterPlugins);
document.getElementById('clear-search').addEventListener('click', () => {
  search.value = '';
  filters[0].click();
  search.focus();
});

const permissionLabels = {
  'storage.own': '保存这个插件自己的设置和数据',
  'ui.reminders': '通过桌宠显示气泡与提醒',
  'weather.read': '查询城市和天气预报',
  'codex.read': '只读本机 Codex 额度与任务状态',
  'ai.deepseek': '调用你配置的 DeepSeek 对话服务',
  'net.local': '访问你明确授权的本机服务',
};
const dialog = document.getElementById('plugin-dialog');
let dialogTrigger;
document.querySelectorAll('[data-details]').forEach(button => button.addEventListener('click', () => {
  const plugin = data.plugins.find(item => item.id === button.dataset.details);
  if (!plugin) return;
  dialogTrigger = button;
  document.getElementById('dialog-title').textContent = plugin.name;
  document.getElementById('dialog-description').textContent = plugin.description;
  const fields = [['作者', plugin.author], ['插件版本', `v${plugin.version}`], ['最低桌宠版本', `v${plugin.minHostVersion}`], ['插件 ID', plugin.id]];
  document.getElementById('dialog-meta').replaceChildren(...fields.flatMap(([label, value]) => {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    return [dt, dd];
  }));
  document.getElementById('dialog-setup').textContent = plugin.setup;
  const permissions = plugin.permissions.length ? plugin.permissions.map(permission => `${permissionLabels[permission] || permission}（${permission}）`) : ['无需额外权限，不联网、不保存数据。'];
  document.getElementById('dialog-permissions').replaceChildren(...permissions.map(text => {
    const li = document.createElement('li'); li.textContent = text; return li;
  }));
  document.getElementById('dialog-checksum').value = plugin.sha256;
  document.getElementById('dialog-download').href = plugin.downloadUrl;
  document.getElementById('dialog-source').href = plugin.sourceUrl;
  dialog.showModal();
}));
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
});
dialog.addEventListener('close', () => dialogTrigger?.focus());

const commands = {
  plugin: {
    note: '先克隆项目，再从零权限计数器示例开始。',
    code: `git clone ${repo}.git\ncd spine-pet-workshop\n\n# 修改 examples/hello-counter-plugin 中的示例\n# 打包后，在「扩展」中导入生成的 ZIP\nnode scripts/package-plugin.mjs examples/hello-counter-plugin release/plugins/Hello-Counter-v1.0.0.zip`,
    requirement: '需要 Node.js 24 · 示例打包无需安装 Electron',
  },
  app: {
    note: '准备本地角色素材后，在 Windows 上运行。素材放置方法见源码开发文档。',
    code: `git clone ${repo}.git\ncd spine-pet-workshop\n\npnpm install --frozen-lockfile\npnpm dev\n\n# 构建与启动\npnpm build\npnpm start`,
    requirement: 'Windows x64 · Node.js 24 · pnpm 11',
  },
};
setupTabs('[data-terminal]', tab => {
  const command = commands[tab.dataset.terminal];
  document.getElementById('terminal-note').textContent = command.note;
  document.getElementById('terminal-code').textContent = command.code;
  document.getElementById('terminal-requirement').textContent = command.requirement;
  document.getElementById('terminal-panel').setAttribute('aria-labelledby', tab.id);
  document.getElementById('copy-feedback').textContent = '';
});
document.getElementById('copy-command').addEventListener('click', async () => {
  const code = document.getElementById('terminal-code');
  const feedback = document.getElementById('copy-feedback');
  try {
    await navigator.clipboard.writeText(code.textContent);
    feedback.textContent = '已复制，可以粘贴到 PowerShell。';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange(); range.selectNodeContents(code);
    selection.removeAllRanges(); selection.addRange(range);
    feedback.textContent = '浏览器未允许自动复制，已选中命令，请按 Ctrl+C 复制。';
  }
});

// CSS handles wheel, touch and keyboard scrolling; this only updates navigation.
const sections = [...document.querySelectorAll('.snap-panel')];
const chapterLinks = [...document.querySelectorAll('.section-rail a, .site-header nav a')];
const nextPage = document.querySelector('.page-next');
let scrollUpdatePending = false;
function updateChapter() {
  const marker = Math.min(innerHeight * .38, 260);
  const active = sections.find(section => {
    const box = section.getBoundingClientRect();
    return box.top <= marker && box.bottom > marker;
  }) || sections[0];
  for (const link of chapterLinks) {
    if (link.hash === `#${active.id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  document.documentElement.dataset.section = active.id;
  const following = sections[sections.indexOf(active) + 1];
  nextPage.hidden = !following;
  if (following) {
    const title = following.querySelector('h2').textContent.replace(/[+_]/g, '').trim();
    nextPage.href = `#${following.id}`;
    nextPage.setAttribute('aria-label', `向下翻页：${title}`);
    nextPage.querySelector('.page-next-name').textContent = title;
  }
  scrollUpdatePending = false;
}
window.addEventListener('scroll', () => {
  if (!scrollUpdatePending) { scrollUpdatePending = true; requestAnimationFrame(updateChapter); }
}, { passive: true });
window.addEventListener('resize', updateChapter);
updateChapter();

const contributionTypes = {
  plugin: {
    title: '上传与分享插件', prefix: '插件收录',
    description: '先把 ZIP 上传到自己的 GitHub Release，再填写下面的信息申请收录。投稿指南中有完整的上传步骤。',
    fields: [
      { id: 'name', label: '插件名称与版本', placeholder: '例如：桌面便签 / 1.0.0', max: 100 },
      { id: 'identity', label: '插件 ID', placeholder: '例如：io.yourname.notes', max: 100 },
      { id: 'source', label: 'GitHub 源码地址', type: 'url', placeholder: 'https://github.com/作者/仓库', wide: true, pattern: 'https://github\\.com/.+' },
      { id: 'download', label: '插件 ZIP 下载链接', type: 'url', placeholder: 'GitHub Release 中的固定版本 ZIP 链接', wide: true, pattern: 'https://github\\.com/.+/releases/download/.+', max: 500 },
      { id: 'checksum', label: 'ZIP 的 SHA-256', placeholder: '64 位文件校验值', wide: true, pattern: '[a-fA-F0-9]{64}', max: 64, help: '可用 PowerShell：Get-FileHash -Algorithm SHA256 -LiteralPath 你的插件.zip' },
      { id: 'description', label: '功能、最低桌宠版本与权限', type: 'textarea', placeholder: '说明插件能做什么、测试过的桌宠版本，以及需要哪些权限。', wide: true, max: 1200 },
    ],
  },
  feedback: {
    title: '提交意见', prefix: '意见反馈',
    description: '告诉我们哪里不好用，或发生了什么问题。具体的操作步骤有助于排查。',
    fields: [
      { id: 'name', label: '反馈主题', placeholder: '用一句话说明问题或建议', wide: true, max: 120 },
      { id: 'description', label: '具体情况', type: 'textarea', placeholder: '做了什么操作？期望怎样？实际发生了什么？', wide: true, max: 1800 },
      { id: 'environment', label: '桌宠版本与系统版本（可选）', placeholder: `例如：SpinePet ${data.version} / Windows 11`, wide: true, optional: true, max: 200 },
    ],
  },
  wish: {
    title: '功能许愿', prefix: '功能许愿',
    description: '不需要先考虑怎么开发。说清楚你希望的使用效果，以及会在什么场景用到它。',
    fields: [
      { id: 'name', label: '想要什么功能？', placeholder: '用一句话描述你的愿望', wide: true, max: 120 },
      { id: 'description', label: '使用场景与期望效果', type: 'textarea', placeholder: '什么时候会用到？希望桌宠如何帮助你？', wide: true, max: 1800 },
      { id: 'participation', label: '补充想法（可选）', placeholder: '例如：愿意测试、已有设计或相关工具', wide: true, optional: true, max: 200 },
    ],
  },
};
const contributionDialog = document.getElementById('contribution-dialog');
const contributionForm = document.getElementById('contribution-form');
let contributionTrigger;
let contributionType;
const contributionDrafts = {};
function saveContributionDraft() {
  if (!contributionType) return;
  contributionDrafts[contributionType] = Object.fromEntries(contributionTypes[contributionType].fields.map(field => [field.id, document.getElementById(`contribution-input-${field.id}`).value]));
}
document.querySelectorAll('[data-contribute]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  contributionType = link.dataset.contribute;
  const config = contributionTypes[contributionType];
  contributionTrigger = link;
  document.getElementById('contribution-title').textContent = config.title;
  document.getElementById('contribution-description').textContent = config.description;
  const fields = config.fields.map(field => {
    const label = document.createElement('label');
    label.className = `contribution-field${field.wide ? ' wide' : ''}`;
    const caption = document.createElement('span'); caption.textContent = field.label;
    const control = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
    control.id = `contribution-input-${field.id}`;
    if (field.type !== 'textarea') control.type = field.type || 'text';
    control.required = !field.optional;
    control.maxLength = field.max || 500;
    control.placeholder = field.placeholder;
    control.value = contributionDrafts[contributionType]?.[field.id] || '';
    if (field.pattern) { control.pattern = field.pattern; control.title = field.id === 'checksum' ? '请输入 64 位十六进制 SHA-256 校验值' : '请使用有效的 HTTPS GitHub 地址'; }
    label.append(caption, control);
    if (field.help) { const hint = document.createElement('small'); hint.id = `${control.id}-help`; hint.textContent = field.help; control.setAttribute('aria-describedby', hint.id); label.append(hint); }
    return label;
  });
  document.getElementById('contribution-fields').replaceChildren(...fields);
  document.getElementById('form-handoff').textContent = '下一步将打开 GitHub，登录并确认后才会提交。' + (contributionType === 'plugin' ? ' ZIP 文件请先上传到你自己的 GitHub Release。' : ' 截图可以在 GitHub 编辑页补充。');
  contributionDialog.showModal();
}));
contributionForm.addEventListener('submit', () => {
  const config = contributionTypes[contributionType];
  saveContributionDraft();
  const draft = contributionDrafts[contributionType];
  document.getElementById('issue-title').value = `[${config.prefix}] ${draft.name.trim()}`;
  document.getElementById('issue-body').value = config.fields.map(field => `### ${field.label}\n\n${draft[field.id].trim() || '未填写'}`).join('\n\n');
  // Native form submission opens an editable GitHub draft; no issue is posted here.
});
document.getElementById('close-contribution').addEventListener('click', () => contributionDialog.close());
contributionDialog.addEventListener('click', event => {
  const box = contributionDialog.getBoundingClientRect();
  if (event.target === contributionDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) contributionDialog.close();
});
contributionDialog.addEventListener('close', () => {
  saveContributionDraft();
  contributionTrigger?.focus();
});

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change', event => {
  if (!event.matches) return;
  // Cancel in-flight motion too, so changing the preference takes effect immediately.
  window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
  document.getAnimations().forEach(animation => animation.cancel());
  document.querySelectorAll('.press-wave').forEach(wave => wave.remove());
});
const showcaseImage = document.getElementById('showcase-image');
const showcaseModes = {
  pet: { file: 'pet.png', title: 'SPINEPET / DESKTOP COMPANION', label: '真实桌宠', alt: '当前 v5.3.1 阿米娅桌宠待机状态实拍', caption: '真实桌宠窗口实拍 · v5.3.1 · 待机状态' },
  library: { file: 'library.png', title: 'SPINEPET / CHARACTER LIBRARY', label: '角色库', alt: '重新启动当前 v5.3.1 后实拍的角色管理器与参数设置', caption: '当前管理器实拍 · v5.3.1 · 角色与语音设置' },
  models: { file: 'models.png', title: 'SPINEPET / MODEL SEARCH', label: '模型检索', alt: '当前 v5.3.1 模型与语音检索结果，包含角色分类、配音语种与下载入口', caption: '当前模型检索实拍 · 基建小人、动态立绘与敌方模型可分类查找' },
  scene: { file: 'images/desktop-scene.png', title: 'SPINEPET / DESKTOP SCENE', label: '桌面搭配', alt: '阿米娅时装桌宠与桌面背景搭配展示', caption: '桌宠与壁纸搭配展示' },
};
let showcaseRequest = 0;
setupTabs('[data-showcase]', async tab => {
  const request = ++showcaseRequest;
  const mode = showcaseModes[tab.dataset.showcase];
  const preloader = new Image();
  preloader.src = `assets/${mode.file}`;
  try { await preloader.decode(); } catch { return; }
  if (request !== showcaseRequest) return;
  showcaseImage.src = preloader.src;
  showcaseImage.classList.toggle('pet-shot', tab.dataset.showcase === 'pet');
  document.querySelector('.showcase-open').classList.toggle('is-pet', tab.dataset.showcase === 'pet');
  showcaseImage.alt = mode.alt;
  document.getElementById('showcase-window-title').textContent = mode.title;
  document.getElementById('showcase-caption').textContent = mode.caption;
  document.getElementById('showcase-panel').setAttribute('aria-labelledby', tab.id);
  document.querySelector('.showcase-open').setAttribute('aria-label', `放大查看${mode.label}截图`);
  if (!reducedMotion.matches) showcaseImage.animate([{ opacity: .3, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 350, easing: 'cubic-bezier(.2,.7,.2,1)' });
});

const imageDialog = document.getElementById('image-dialog');
let imageTrigger;
function openImage(source, description, trigger) {
  imageTrigger = trigger;
  document.getElementById('image-dialog-image').src = source;
  document.getElementById('image-dialog-image').alt = description;
  document.getElementById('image-dialog-title').textContent = description;
  imageDialog.showModal();
}
document.querySelector('.showcase-open').addEventListener('click', event => openImage(showcaseImage.src, showcaseImage.alt, event.currentTarget));
document.querySelector('.guide-image').addEventListener('click', event => {
  event.preventDefault();
  const image = event.currentTarget.querySelector('img');
  openImage(image.src, image.alt, event.currentTarget);
});
document.getElementById('close-image-dialog').addEventListener('click', () => imageDialog.close());
imageDialog.addEventListener('close', () => imageTrigger?.focus());
imageDialog.addEventListener('click', event => {
  const box = imageDialog.getBoundingClientRect();
  if (event.target === imageDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) imageDialog.close();
});

// Brief feedback for pointer input, while keyboard input retains native :active/focus states.
document.addEventListener('pointerdown', event => {
  const control = event.target.closest('.button, .guide-tab, .filter, .showcase-tabs button, .terminal-tabs button');
  if (!control || reducedMotion.matches || (event.button !== undefined && event.button !== 0)) return;
  const box = control.getBoundingClientRect();
  const wave = document.createElement('i');
  wave.className = 'press-wave';
  wave.setAttribute('aria-hidden', 'true');
  const diameter = Math.max(box.width, box.height) * 2;
  Object.assign(wave.style, { width: `${diameter}px`, height: `${diameter}px`, left: `${event.clientX - box.left}px`, top: `${event.clientY - box.top}px` });
  control.append(wave);
  wave.addEventListener('animationend', () => wave.remove(), { once: true });
}, { passive: true });

const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    revealObserver.unobserve(entry.target);
    if (!reducedMotion.matches) entry.target.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 550, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
}, { threshold: .12 });
document.querySelectorAll('.hero-copy, .hero-visual, .section-heading, .guide-layout, .plugin-grid, .participation-grid, .developer-copy, .terminal').forEach(element => revealObserver.observe(element));

// The pet keeps its height and slides out to the right while the image is in use.
const companionHost = document.querySelector('.hero-visual');
const edgeCompanion = document.querySelector('.edge-companion');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let companionReturnTimer;
function slideCompanionOut() {
  clearTimeout(companionReturnTimer);
  if (companionHost.dataset.companionAway !== 'true') companionHost.dataset.companionAway = 'true';
}
companionHost.addEventListener('pointermove', event => {
  if (!finePointer.matches || event.pointerType === 'touch') return;
  const picture = companionHost.querySelector('.app-shot').getBoundingClientRect();
  const pet = edgeCompanion.getBoundingClientRect();
  const overPicture = event.clientX >= picture.left && event.clientX <= picture.right && event.clientY >= picture.top && event.clientY <= picture.bottom;
  const nearPet = event.clientX >= pet.left - 24 && event.clientX <= pet.right + 24 && event.clientY >= pet.top - 24 && event.clientY <= pet.bottom + 24;
  if (overPicture || nearPet) slideCompanionOut();
}, {passive: true});
companionHost.addEventListener('pointerleave', () => {
  companionReturnTimer = setTimeout(() => {
    if (!companionHost.querySelector(':focus-visible')) delete companionHost.dataset.companionAway;
  }, 240);
});
companionHost.addEventListener('focusin', event => { if (event.target.matches(':focus-visible')) slideCompanionOut(); });
companionHost.addEventListener('focusout', event => {
  if (!companionHost.contains(event.relatedTarget)) {
    companionReturnTimer = setTimeout(() => { delete companionHost.dataset.companionAway; }, 240);
  }
});
