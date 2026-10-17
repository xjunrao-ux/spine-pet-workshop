// 一个没有依赖、无需构建的 JavaScript 插件。
export function activate(context) {
  let count = 0;
  let closed = false;

  function getSnapshot() {
    return {
      available: true,
      status: 'ready',
      pages: [{
        id: 'main',
        title: '我的第一个插件',
        icon: 'plus',
        blocks: [
          { type: 'text', text: `你已经点击了 ${count} 次。` },
          { type: 'button', commandId: 'increment', label: '加一',
            icon: 'plus', enabled: true, variant: 'text', payload: {} },
          { type: 'button', commandId: 'reset', label: '清零',
            icon: 'undo', enabled: true, variant: 'text', payload: {} }
        ]
      }]
    };
  }

  return {
    getSnapshot,
    execute(commandId) {
      if (closed || context.signal.aborted) throw new Error('插件已停止');
      if (commandId === 'increment') {
        if (!Number.isSafeInteger(count + 1)) throw new Error('计数已达上限');
        count += 1;
      } else if (commandId === 'reset') {
        count = 0;
      } else {
        throw new Error('未知命令');
      }
      // 宿主在命令完成后重新读取 getSnapshot，自动刷新界面。
      return null;
    },
    dispose() { closed = true; }
  };
}
