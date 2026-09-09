import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { inspectGameProject } from './game-export.mjs';

/** One directory at a time. No shell, native dialog, project writes or recursive scan. */
export async function browseGameProjects(repositoryRoot, input = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => k !== 'directory')
  )
    throw new Error('无效的文件夹浏览请求。');
  const requested = input.directory || path.dirname(repositoryRoot);
  if (
    typeof requested !== 'string' ||
    requested.length > 2000 ||
    !path.isAbsolute(requested) ||
    requested.includes('\0')
  )
    throw new Error('请输入文件夹的绝对路径。');
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const directory = await realpath(
          path.basename(requested).toLowerCase() === 'project.godot'
            ? path.dirname(requested)
            : requested,
        );
        if (!(await stat(directory)).isDirectory())
          throw new Error('这不是文件夹，请选择游戏项目所在的文件夹。');
        const entries = await readdir(directory, { withFileTypes: true });
        const folders = entries
          .filter(
            (e) =>
              e.isDirectory() &&
              !e.isSymbolicLink() &&
              !e.name.startsWith('.') &&
              ![
                'node_modules',
                '$RECYCLE.BIN',
                'System Volume Information',
              ].includes(e.name),
          )
          .sort((a, b) =>
            a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
          );
        let project = null,
          projectIssue = null;
        if (
          entries.some(
            (e) => e.name.toLowerCase() === 'project.godot' && e.isFile(),
          )
        ) {
          try {
            const p = await inspectGameProject(directory);
            project = {
              path: p.path,
              name: p.name,
              versionWarning: p.versionWarning,
            };
          } catch (e) {
            projectIssue = e.message;
          }
        }
        const roots = [
          ...new Set([
            path.parse(repositoryRoot).root,
            path.parse(homedir()).root,
            homedir(),
          ]),
        ].map((p) => ({ path: p, name: p === homedir() ? '个人文件夹' : p }));
        return {
          directory,
          parent:
            path.dirname(directory) === directory
              ? null
              : path.dirname(directory),
          roots,
          folders: folders
            .slice(0, 500)
            .map((e) => ({ name: e.name, path: path.join(directory, e.name) })),
          truncated: folders.length > 500,
          project,
          projectIssue,
          readOnly: true,
        };
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error('读取文件夹超时，请选择其他目录或直接输入项目路径。'),
            ),
          5000,
        );
      }),
    ]);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code))
      throw new Error('文件夹不存在，请检查路径或选择上一级。');
    if (['EACCES', 'EPERM'].includes(error.code))
      throw new Error('此文件夹无法读取，请选择其他目录。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
