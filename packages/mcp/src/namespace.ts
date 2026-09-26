/** Prefix an MCP original tool name with the server key. */
export function prefixToolName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}

/**
 * Strip `{server}__` from a namespaced tool name.
 * Returns null if the name does not belong to this server.
 */
export function stripToolPrefix(
  serverName: string,
  namespacedName: string,
): string | null {
  const prefix = `${serverName}__`;
  if (!namespacedName.startsWith(prefix)) {
    return null;
  }
  const rest = namespacedName.slice(prefix.length);
  return rest.length > 0 ? rest : null;
}
