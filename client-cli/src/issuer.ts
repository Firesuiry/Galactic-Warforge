/** 发令者配置：`SW_ISSUER=<名>` 时以 agent 身份发令（issuer_type=agent），不设时由玩家本人发令。 */
export type IssuerAuth = { issuerType: 'agent'; issuerId: string };

/**
 * 非法值不抛异常（模块初始化时抛会变成裸栈退出）：返回 `{ error }`，
 * 由入口打印中文原因后退出。REPL 与 `scripts/sw` 共用同一套校验。
 */
export function issuerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IssuerAuth | { error: string } | undefined {
  const name = env.SW_ISSUER?.trim();
  if (!name) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(name)) {
    return { error: `SW_ISSUER 非法（${name}）：只允许字母、数字、_ . : -，最长 64 字符` };
  }
  return { issuerType: 'agent', issuerId: name };
}
