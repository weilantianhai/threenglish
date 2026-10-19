// lib/backHandler.ts
// 安卓返回键的拦截栈：最上层先处理，处理了就不再返回上一页。
// 现在只有单词卡弹层用得到，以后加别的全屏浮层也走这里。

type BackHandler = () => boolean;

const stack: BackHandler[] = [];

/** 注册一个返回键处理器，返回注销函数 */
export function registerBackHandler(handler: BackHandler): () => void {
  stack.push(handler);

  return () => {
    const index = stack.indexOf(handler);
    if (index >= 0) stack.splice(index, 1);
  };
}

/** 交给最上层的处理器；返回 true 表示已消费这次返回键 */
export function runTopBackHandler(): boolean {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  return handler();
}

export function hasBackHandler(): boolean {
  return stack.length > 0;
}
