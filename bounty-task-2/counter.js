/**
 * 计数器模块
 * 实现基本的 +1/-1 功能
 */

let count = 0;

export function getCount() {
    return count;
}

export function increment() {
    count++;
    return count;
}

export function decrement() {
    count--;
    return count;
}

export function reset() {
    count = 0;
    return count;
}

// DOM 初始化
export function initCounter() {
    const valueEl = document.getElementById('counter-value');
    const incrementBtn = document.getElementById('increment');
    const decrementBtn = document.getElementById('decrement');
    
    if (!valueEl || !incrementBtn || !decrementBtn) {
        return;
    }
    
    incrementBtn.addEventListener('click', () => {
        increment();
        valueEl.textContent = getCount();
    });
    
    decrementBtn.addEventListener('click', () => {
        decrement();
        valueEl.textContent = getCount();
    });
}

// 如果是浏览器环境，自动初始化
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initCounter);
}
