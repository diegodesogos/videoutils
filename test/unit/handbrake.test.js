const test = require('node:test');
const assert = require('node:assert');
const child_process = require('child_process');
const { scanDvd, convertDvdTitle } = require('../../src/utils/handbrake');

test('HandBrake CLI wrapper - scanDvd parses titles correctly', async (t) => {
    const mockSpawn = t.mock.method(child_process, 'spawn', () => {
        return {
            stdout: {
                on: (event, cb) => {
                    if (event === 'data') {
                        cb(Buffer.from(`
+ title 1:
  + autoupdate:
  + duration: 00:05:20
+ title 2:
  + autoupdate:
  + duration: 01:10:05
+ title 3:
  + autoupdate:
  + duration: 00:00:05
`));
                    }
                }
            },
            stderr: {
                on: (event, cb) => {}
            },
            on: (event, cb) => {
                if (event === 'close') {
                    setTimeout(() => cb(0), 10);
                }
            }
        };
    });

    const titles = await scanDvd('/path/to/dvd');
    
    assert.strictEqual(titles.length, 3);
    assert.deepStrictEqual(titles[0], { title: 1, duration: '00:05:20', durationSeconds: 320 });
    assert.deepStrictEqual(titles[1], { title: 2, duration: '01:10:05', durationSeconds: 4205 });
    assert.deepStrictEqual(titles[2], { title: 3, duration: '00:00:05', durationSeconds: 5 });
});
