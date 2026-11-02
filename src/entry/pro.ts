/* 高级版入口。
 * 高级模块（标注 / 统计 / AI / 多格式）在 M3 之后从这里挂上来；
 * 现在与基础版唯一区别是认得的格式更多。 */
import { createPlugin } from '../plugin';

export default createPlugin({ pro: true });
