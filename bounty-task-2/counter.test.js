/**
 * 计数器测试
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { getCount, increment, decrement, reset } from './counter.js';

describe('计数器模块', () => {
    beforeEach(() => {
        reset();
    });

    it('初始值为 0', () => {
        expect(getCount()).toBe(0);
    });

    it('increment() 使计数 +1', () => {
        expect(increment()).toBe(1);
        expect(increment()).toBe(2);
        expect(getCount()).toBe(2);
    });

    it('decrement() 使计数 -1', () => {
        expect(decrement()).toBe(-1);
        expect(decrement()).toBe(-2);
        expect(getCount()).toBe(-2);
    });

    it('reset() 将计数重置为 0', () => {
        increment();
        increment();
        expect(getCount()).toBe(2);
        reset();
        expect(getCount()).toBe(0);
    });
});
