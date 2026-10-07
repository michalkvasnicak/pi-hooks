import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("pi-hooks", {
    description: "Example command from the pi-hooks extension",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-hooks is loaded", "info");
    },
  });
}
