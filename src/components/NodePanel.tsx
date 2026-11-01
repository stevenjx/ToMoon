import { ButtonItem, PanelSection, PanelSectionRow, Spinner } from "@decky/ui";
import { FC, useEffect, useState } from "react";

import * as backend from "../backend/backend";
import { localizationManager, L } from "../i18n";

interface NodePanelProp {
  enabled: boolean;
}

export const NodePanel: FC<NodePanelProp> = ({ enabled }) => {
  const [groups, setGroups] = useState<backend.ProxyGroup[]>([]);
  const [delays, setDelays] = useState<Record<string, number>>({});
  const [testing, setTesting] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = async () => {
    if (!enabled) {
      setGroups([]);
      return;
    }
    const list = await backend.getProxyGroups();
    setGroups(list);
  };

  useEffect(() => {
    load();
  }, [enabled]);

  const testAll = async () => {
    const members = groups.flatMap((g) => g.members);
    if (members.length === 0) return;
    setTesting(true);
    setDelays({});
    // 逐个测，避免同时开几十个连接把窄带占满
    for (const name of members) {
      const delay = await backend.testProxyDelay(name);
      setDelays((prev) => ({ ...prev, [name]: delay }));
    }
    setTesting(false);
  };

  const pick = async (group: string, name: string) => {
    setSwitching(true);
    await backend.selectProxy(group, name);
    await load();
    setSwitching(false);
  };

  const delayLabel = (name: string) => {
    const d = delays[name];
    if (d === undefined) return "";
    return d < 0 ? "✕" : `${d} ms`;
  };

  // 只有一个分组时不需要把组名顶出来，多分组才显示
  const showGroupTitle = groups.length > 1;

  return (
    <PanelSection title={localizationManager.getString(L.NODES)}>
      {groups.length === 0 && (
        <PanelSectionRow>
          <div style={{ fontSize: "0.8em", opacity: 0.7, padding: "0 16px" }}>
            {enabled
              ? localizationManager.getString(L.NO_NODE)
              : localizationManager.getString(L.ENABLE_CLASH_DESC)}
          </div>
        </PanelSectionRow>
      )}

      {groups.map((group) => (
        <PanelSectionRow>
          <div key={group.name} style={{ padding: "0 16px" }}>
            {showGroupTitle && (
              <div style={{ fontSize: "0.8em", opacity: 0.7, marginBottom: "4px" }}>
                {group.name}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "4px 8px",
              }}
            >
              {group.members.map((name) => {
                const active = name === group.now;
                return (
                  <div key={name}>
                    <ButtonItem
                      layout="below"
                      disabled={switching}
                      onClick={() => pick(group.name, name)}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "8px",
                          opacity: active ? 1 : 0.8,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {active ? "● " : ""}
                          {name}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: "0.85em" }}>
                          {delayLabel(name)}
                        </span>
                      </div>
                    </ButtonItem>
                  </div>
                );
              })}
            </div>
          </div>
        </PanelSectionRow>
      ))}

      {groups.length > 0 && (
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={testing} onClick={testAll}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              {testing
                ? localizationManager.getString(L.TESTING)
                : localizationManager.getString(L.TEST_ALL_DELAY)}
              {testing && <Spinner style={{ margin: "0 0 0 8px", width: "1.1em" }} />}
            </span>
          </ButtonItem>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
};