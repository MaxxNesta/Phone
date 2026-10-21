import { getCompany } from "@/lib/queries";
import { createPartner } from "@/lib/actions";
import { SimpleForm } from "@/components/simple-form";
import { HelpHint } from "@/components/help-hint";
import { REGION_GROUPS } from "@/lib/regions";
import { sql } from "@/lib/db";
import { getTranslations } from "next-intl/server";

export default async function NewPartner() {
  // The layout already read the company; this is that same cached read.
  const co = await getCompany();
  const t = await getTranslations("partners");
  const c = await getTranslations("common");
  const it = await getTranslations("items");
  const f = await getTranslations("itemForm");
  if (!co) return <div className="empty">{c("noCompany")}</div>;
  const currencies = await sql`select code, name from currency order by code`;
  const levels = (await sql`
    select id, name from price_level where company_id = ${co.id} order by sort_order`
  ) as unknown as { id: string; name: string }[];
  const allCats = (await sql`
    select id, name, kind from partner_category
     where company_id = ${co.id} and is_active order by sort_order, name`
  ) as unknown as { id: string; name: string; kind: string }[];
  const cats = allCats.filter((c) => c.kind === "CUSTOMER");
  const supplierCats = allCats.filter((c) => c.kind === "SUPPLIER");

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{it("masterData")}</span>
        <h1>{t("newTitle")}</h1>
        <HelpHint>{t("newHelp")}</HelpHint>
      </div>

      <SimpleForm action={createPartner} submitLabel={t("save")}>
        <div className="card">
          <div className="card-head"><h2>{t("identity")}</h2></div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label htmlFor="code">{c("code")}</label>
                <input id="code" name="code" type="text" placeholder="C-005" required />
                <span className="hint">{t("codeHint")}</span>
              </div>
              <div className="field">
                <label htmlFor="name">{c("name")}</label>
                <input id="name" name="name" type="text" placeholder="Golden Land Superstore" required />
              </div>
              <div className="field">
                <label htmlFor="name_my">{f("nameBurmese")}</label>
                <input id="name_my" name="name_my" type="text" placeholder="မြန်မာလို အမည်" />
                <span className="hint">{t("unicodeOnly")}</span>
              </div>
              <div className="field">
                <label htmlFor="company_name">{t("registeredCompany")}</label>
                <input id="company_name" name="company_name" type="text" />
              </div>
              <div className="field">
                <label htmlFor="member_card_id">{t("memberCard")}</label>
                <input id="member_card_id" name="member_card_id" type="text" />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>{t("role")}</h2></div>
          <div className="card-body">
            <div className="row">
              <label className="check" htmlFor="is_customer">
                <input id="is_customer" name="is_customer" type="checkbox" defaultChecked />
                {t("isCustomer")}
              </label>
              <label className="check" htmlFor="is_supplier">
                <input id="is_supplier" name="is_supplier" type="checkbox" />
                {t("isSupplier")}
              </label>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>{t("termsContact")}</h2></div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label htmlFor="currency">{t("currency")}</label>
                <input id="currency" name="currency" list="currency-codes" maxLength={3}
                  placeholder="MMK" style={{ textTransform: "uppercase" }} />
                <datalist id="currency-codes">
                  {currencies.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </datalist>
                <span className="hint">{t("currencyHint")}</span>
              </div>
              <div className="field">
                <label htmlFor="payment_terms_days">{t("paymentTerms")}</label>
                <input id="payment_terms_days" name="payment_terms_days" type="number" min="0" defaultValue={30} />
                <span className="hint">{t("paymentTermsHint")}</span>
              </div>
              <div className="field">
                <label htmlFor="price_level_id">{t("priceLevel")}</label>
                <select id="price_level_id" name="price_level_id" defaultValue="">
                  <option value="">{t("default")}</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <span className="hint">{t("priceLevelHint")}</span>
              </div>
              {/* What kind of shop, for reporting. Deliberately next to the
                  price level and deliberately not doing its job: the level
                  decides what they pay, the category only says what they
                  are. */}
              <div className="field">
                <label htmlFor="category_id">{t("customerCategory")}</label>
                <select id="category_id" name="category_id" defaultValue="">
                  <option value="">Not categorised</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span className="hint">
                  {cats.length === 0
                    ? t("noCustomerCats")
                    : t("customerCatHint")}
                </span>
              </div>
              {/* The other axis. A company we both sell to and buy from is
                  two different things to us, so it is filed twice. */}
              <div className="field">
                <label htmlFor="supplier_category_id">{t("supplierCategory")}</label>
                <select id="supplier_category_id" name="supplier_category_id" defaultValue="">
                  <option value="">Not categorised</option>
                  {supplierCats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <span className="hint">
                  {supplierCats.length === 0
                    ? t("noSupplierCats")
                    : t("supplierCatHint")}
                </span>
              </div>
              <div className="field">
                <label htmlFor="credit_limit">{t("creditLimit")}</label>
                <input id="credit_limit" name="credit_limit" type="number" min="0" step="any" />
                <span className="hint">{t("creditLimitHint")}</span>
              </div>
              {/* Region groups for reporting; township stays the address
                  line it has always been. Two different jobs, which is why
                  one is a fixed list and the other is free text. */}
              <div className="field">
                <label htmlFor="region">{t("region")}</label>
                <select id="region" name="region" defaultValue="">
                  <option value="">{t("notSet")}</option>
                  {REGION_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((r) => <option key={r} value={r}>{r}</option>)}
                    </optgroup>
                  ))}
                </select>
                <span className="hint">{t("regionHint")}</span>
              </div>
              <div className="field">
                <label htmlFor="township">{t("township")}</label>
                <input id="township" name="township" type="text" placeholder="Bahan" />
              </div>
              <div className="field">
                <label htmlFor="phone">{t("phone")}</label>
                <input id="phone" name="phone" type="text" placeholder="09-..." />
              </div>
            </div>
            <div className="field" style={{ marginTop: "1rem" }}>
              <label htmlFor="address">{t("address")}</label>
              <input id="address" name="address" type="text" />
            </div>
          </div>
        </div>
      </SimpleForm>
    </>
  );
}
