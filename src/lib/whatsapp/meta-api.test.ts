import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERACTIVE_LIMITS,
  sendInteractiveButtons,
  sendInteractiveList,
  sendSingleProduct,
  sendProductList,
} from "./meta-api";

// All assertions in this file run BEFORE the network call. We stub fetch
// to a never-resolving mock so a test that accidentally falls through to
// the request body would hang (and fail) rather than silently hit
// graph.facebook.com.
const neverFetch = () =>
  new Promise<Response>(() => {
    /* intentionally never resolves */
  });

const BASE_ARGS = {
  phoneNumberId: "test-phone",
  accessToken: "test-token",
  to: "1234567890",
  bodyText: "Body text",
} as const;

describe("sendInteractiveButtons — validation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an empty buttons array", async () => {
    await expect(
      sendInteractiveButtons({ ...BASE_ARGS, buttons: [] }),
    ).rejects.toThrow(/1-3 buttons/);
  });

  it(`rejects more than ${INTERACTIVE_LIMITS.maxButtons} buttons (Meta cap)`, async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
          { id: "c", title: "C" },
          { id: "d", title: "D" },
        ],
      }),
    ).rejects.toThrow(/1-3 buttons/);
  });

  it("rejects a button title longer than 20 chars (Meta cap)", async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [
          { id: "a", title: "x".repeat(INTERACTIVE_LIMITS.buttonTitleMaxLength + 1) },
        ],
      }),
    ).rejects.toThrow(/exceeds 20 chars/);
  });

  it("rejects a button missing its id", async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        buttons: [{ id: "", title: "Choose me" }],
      }),
    ).rejects.toThrow(/missing id/);
  });

  it("rejects an empty body text", async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        bodyText: "",
        buttons: [{ id: "a", title: "A" }],
      }),
    ).rejects.toThrow(/requires bodyText/);
  });

  it("rejects a header text over the limit", async () => {
    await expect(
      sendInteractiveButtons({
        ...BASE_ARGS,
        headerText: "x".repeat(INTERACTIVE_LIMITS.headerTextMaxLength + 1),
        buttons: [{ id: "a", title: "A" }],
      }),
    ).rejects.toThrow(/headerText exceeds/);
  });

  it("sends the right payload shape when all inputs are valid", async () => {
    let captured: { url: string; body: unknown; method: string } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = {
          url,
          method: init.method ?? "GET",
          body: JSON.parse(String(init.body)),
        };
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.PASS" }] }),
          { status: 200 },
        );
      }),
    );

    const result = await sendInteractiveButtons({
      ...BASE_ARGS,
      headerText: "Hello",
      footerText: "Tap one",
      buttons: [
        { id: "yes", title: "Yes" },
        { id: "no", title: "No" },
      ],
    });

    expect(result).toEqual({ messageId: "wamid.PASS" });
    expect(captured).not.toBeNull();
    expect(captured!.method).toBe("POST");
    expect(captured!.url).toContain("test-phone/messages");
    expect(captured!.body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "1234567890",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Body text" },
        header: { type: "text", text: "Hello" },
        footer: { text: "Tap one" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "yes", title: "Yes" } },
            { type: "reply", reply: { id: "no", title: "No" } },
          ],
        },
      },
    });
  });
});

describe("sendInteractiveList — validation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ROW = { id: "r1", title: "Row 1" };

  it("rejects zero sections", async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Open",
        sections: [],
      }),
    ).rejects.toThrow(/1-10 sections/);
  });

  it(`rejects more than ${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across sections (Meta cap)`, async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: `r${i}`,
      title: `Row ${i}`,
    }));
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Open",
        sections: [{ rows }],
      }),
    ).rejects.toThrow(/1-10 rows total/);
  });

  it("rejects a row title longer than 24 chars (Meta cap)", async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Open",
        sections: [
          {
            rows: [
              {
                id: "r1",
                title: "x".repeat(INTERACTIVE_LIMITS.listRowTitleMaxLength + 1),
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/exceeds 24 chars/);
  });

  it("rejects duplicate row ids across sections", async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "Open",
        sections: [
          { rows: [{ id: "dupe", title: "First" }] },
          { rows: [{ id: "dupe", title: "Second" }] },
        ],
      }),
    ).rejects.toThrow(/duplicate row id/);
  });

  it("rejects an empty buttonLabel", async () => {
    await expect(
      sendInteractiveList({
        ...BASE_ARGS,
        buttonLabel: "",
        sections: [{ rows: [ROW] }],
      }),
    ).rejects.toThrow(/requires a buttonLabel/);
  });

  it("sends the right payload shape when valid", async () => {
    let captured: { body: unknown } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = { body: JSON.parse(String(init.body)) };
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.LIST" }] }),
          { status: 200 },
        );
      }),
    );

    const result = await sendInteractiveList({
      ...BASE_ARGS,
      buttonLabel: "Open menu",
      sections: [
        {
          title: "Orders",
          rows: [
            { id: "order_1", title: "Order #1", description: "€12" },
            { id: "order_2", title: "Order #2" },
          ],
        },
      ],
    });

    expect(result).toEqual({ messageId: "wamid.LIST" });
    expect(captured).not.toBeNull();
    expect(captured!.body).toMatchObject({
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Body text" },
        action: {
          button: "Open menu",
          sections: [
            {
              title: "Orders",
              rows: [
                { id: "order_1", title: "Order #1", description: "€12" },
                { id: "order_2", title: "Order #2" },
              ],
            },
          ],
        },
      },
    });
  });
});

describe("sendSingleProduct — validation & payload", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects missing catalogId", async () => {
    await expect(
      sendSingleProduct({
        ...BASE_ARGS,
        catalogId: "",
        productRetailerId: "prod-1",
      }),
    ).rejects.toThrow(/requires a catalogId/);
  });

  it("rejects missing productRetailerId", async () => {
    await expect(
      sendSingleProduct({
        ...BASE_ARGS,
        catalogId: "cat-1",
        productRetailerId: "",
      }),
    ).rejects.toThrow(/requires a productRetailerId/);
  });

  it("shapes a single product message payload correctly", async () => {
    let captured: { url: string; body: any } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        captured = { url, body: JSON.parse(init?.body as string) };
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.PROD_SINGLE" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const result = await sendSingleProduct({
      ...BASE_ARGS,
      catalogId: "cat_123",
      productRetailerId: "prod_456",
      bodyText: "Check out this item!",
      footerText: "Tap to view",
    });

    expect(result).toEqual({ messageId: "wamid.PROD_SINGLE" });
    expect(captured).not.toBeNull();
    expect(captured!.body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      type: "interactive",
      interactive: {
        type: "product",
        body: { text: "Check out this item!" },
        footer: { text: "Tap to view" },
        action: {
          catalog_id: "cat_123",
          product_retailer_id: "prod_456",
        },
      },
    });
  });
});

describe("sendProductList — validation & payload", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(neverFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects missing headerText", async () => {
    await expect(
      sendProductList({
        ...BASE_ARGS,
        catalogId: "cat-1",
        headerText: "",
        sections: [{ title: "Featured", productRetailerIds: ["p1"] }],
      }),
    ).rejects.toThrow(/requires headerText/);
  });

  it("rejects empty sections", async () => {
    await expect(
      sendProductList({
        ...BASE_ARGS,
        catalogId: "cat-1",
        headerText: "Catalog",
        sections: [],
      }),
    ).rejects.toThrow(/requires 1-10 sections/);
  });

  it("rejects total products > 30", async () => {
    const ids = Array.from({ length: 31 }, (_, i) => `p_${i}`);
    await expect(
      sendProductList({
        ...BASE_ARGS,
        catalogId: "cat-1",
        headerText: "Catalog",
        sections: [{ title: "All", productRetailerIds: ids }],
      }),
    ).rejects.toThrow(/requires 1-30 products total/);
  });

  it("shapes a product list message payload correctly", async () => {
    let captured: { url: string; body: any } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        captured = { url, body: JSON.parse(init?.body as string) };
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.PROD_LIST" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const result = await sendProductList({
      ...BASE_ARGS,
      catalogId: "cat_999",
      headerText: "Our Catalog",
      bodyText: "Explore our collection",
      footerText: "Free delivery available",
      sections: [
        {
          title: "Makeup",
          productRetailerIds: ["p_1", "p_2"],
        },
      ],
    });

    expect(result).toEqual({ messageId: "wamid.PROD_LIST" });
    expect(captured).not.toBeNull();
    expect(captured!.body).toMatchObject({
      messaging_product: "whatsapp",
      type: "interactive",
      interactive: {
        type: "product_list",
        header: { type: "text", text: "Our Catalog" },
        body: { text: "Explore our collection" },
        footer: { text: "Free delivery available" },
        action: {
          catalog_id: "cat_999",
          sections: [
            {
              title: "Makeup",
              product_items: [
                { product_retailer_id: "p_1" },
                { product_retailer_id: "p_2" },
              ],
            },
          ],
        },
      },
    });
  });
});

