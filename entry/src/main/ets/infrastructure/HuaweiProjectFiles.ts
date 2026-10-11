import { ProjectFiles } from '../application/ProjectStore';

export class HuaweiProjectFiles implements ProjectFiles {
  // TODO(HUAWEI_API): 用官方 Core File Kit 接入应用私有 projects 目录。
  // 输入：已校验项目 ID 下的相对路径及 UTF-8 文本；输出：实际读取、持久写入和同盘原子重命名。
  // write 必须创建父目录、flush 并关闭；rename 必须创建目标父目录，保证替换 HEAD 的原子性；
  // list 只返回直接子文件名。需核验 API 20 的 filesDir、fsync/rename 崩溃持久性、
  // 错误码、目录权限、生命周期和许可；不得把暂存文件当成已提交修订。
  // 官方文档：https://developer.huawei.com/consumer/en/doc/harmonyos-references/js-apis-file-fs
  // 文档正文与上述语义尚未完整核验，当前明确失败，不伪造设备保存成功。
  async read(path: string): Promise<string | undefined> { throw new Error('STORAGE_NOT_INTEGRATED'); }
  async write(path: string, text: string): Promise<void> { throw new Error('STORAGE_NOT_INTEGRATED'); }
  async rename(from: string, to: string): Promise<void> { throw new Error('STORAGE_NOT_INTEGRATED'); }
  async list(folder: string): Promise<string[]> { throw new Error('STORAGE_NOT_INTEGRATED'); }
}
