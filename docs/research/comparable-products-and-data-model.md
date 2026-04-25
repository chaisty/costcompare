# Comparable products & data-model guidance

**Source:** external analysis from ChatGPT, saved 2026-04-24 by user request for use as product/data-model guidance. Not gospel — treat as informed input, reconcile against `CLAUDE.md` invariants before acting. The current MVP invariants (single `rates` table, `procedure_codes: text[]`, RLS-enforced email privacy) still govern; this doc extends the *fields* we might want to capture on a cash-pay quote submission, and frames CostCompare's positioning against existing tools.

---

## Positioning

For **low-coverage / cash-pay procedures**, provider-offered marketplaces like MDsave are too sparse because they depend on provider participation. MDsave itself describes the model as connecting patients with providers offering pre-negotiated services — useful but inherently limited to participating providers. ([MDsave][1])

The closest existing example is **ClearHealthCosts / PriceCheck**. It was explicitly built around collecting and comparing self-pay/cash prices, including consumer shares and provider-reported prices. Their FAQ says they try to collect "all-in" cash/self-pay prices for procedures such as colonoscopy when available, but also acknowledges it is not always available in advance. ([ClearHealthCosts][2]) A Brookings summary describes ClearHealthCosts as comparing self-pay prices for specific providers and notes its Price Check Project compiled prices through crowdsourcing and physician reporting. ([Brookings][3])

The model exists, but has not become dominant because **procedure pricing is hard to normalize**. For CostCompare's use case, the important contribution is not just "what did someone pay?" — it is capturing the **quote structure**.

## Recommended submission fields

For a useful crowdsourced cash-pay database, each entry would ideally carry:

| Field                      | Why it matters                                                             |
| -------------------------- | -------------------------------------------------------------------------- |
| Procedure name             | Human-readable search                                                      |
| CPT/HCPCS codes            | Normalization across providers                                             |
| Diagnosis/indication       | Some prices change based on medical necessity                              |
| Facility name + city/state | Geographic/provider comparison                                             |
| Facility type              | ASC, hospital outpatient, office, imaging center                           |
| Quote amount               | The actual quoted cash price                                               |
| Final paid amount          | Better than quote, if available                                            |
| Was it bundled?            | Core distinction                                                           |
| Included parties           | Facility, surgeon, anesthesia, device/implant, imaging, pathology, post-op |
| Excluded items             | Where surprise bills happen                                                |
| Date of quote/procedure    | Prices age quickly                                                         |
| Source type                | Written quote, phone quote, bill, EOB, receipt                             |
| Insurance status           | Uninsured, denied coverage, out-of-network, high deductible                |
| Outcome status             | Quote only, paid, billed later, disputed                                   |
| Documentation confidence   | Upload verified, user-entered only, provider-confirmed                     |

MVP note: current schema captures price, facility, year, had-procedure flag, `procedure_codes[]`. The fields above are a superset — introduce them as the product matures, not all at once.

## The killer distinction

Separate:

- **Quoted cash price**
- **All-in paid cash price**
- **Insurance allowed amount**
- **Hospital posted discounted cash price**

These are often treated as comparable. They are not. The `rate_type` enum should make the distinction explicit rather than collapsing them.

## Capturing weak-coverage reasons

For procedures with weak insurance coverage, capturing *why* coverage was weak adds analytical value:

| Coverage issue                            | Example                                                  |
| ----------------------------------------- | -------------------------------------------------------- |
| Investigational / not medically necessary | Common for newer procedures                              |
| Prior auth denied                         | Coverage exists but hard to access                       |
| Out-of-network only                       | Patient forced into cash-pay path                        |
| High deductible                           | Insurance technically covers it, but patient pays anyway |
| Site-of-care limitation                   | Hospital covered, ASC not covered, or vice versa         |
| Device/procedure carveout                 | CPT covered but implant/device not included              |

This is especially relevant for 64628 (Intracept), which lives right in the "newer procedure / coverage uncertain" zone.

## Data source layers

Treat crowdsourcing as one layer, not the whole system:

| Layer                              | Source                                    |
| ---------------------------------- | ----------------------------------------- |
| Patient-reported cash quotes/bills | Crowdsourced submissions                  |
| Provider-posted bundles            | MDsave, CashPriceMD, provider websites    |
| Local fair-price estimates         | FAIR Health Consumer                      |
| Cash/self-pay price examples       | ClearHealthCosts                          |
| Hospital discounted cash prices    | Hospital price transparency files         |
| Commercial negotiated anchors      | Turquoise, Sage, payer transparency files |
| Medicare benchmark                 | CMS fee schedules / Medicare lookup tools |

FAIR Health gives consumer-facing cost estimates for thousands of procedures, but is a regional estimator rather than a crowdsourced "what did this exact provider quote?" system. ([fairhealthconsumer.org][4]) ClearHealthCosts is closer to what CostCompare is doing, but its depth varies by procedure and location. ([ClearHealthCosts][2])

The already-decided CostCompare stack aligns with this: user-submitted crowdsourced layer + CMS Medicare layer + pre-processed T-in-C negotiated-rate layer, unified in one `rates` table.

## Positioning statement

The opportunity is not "another estimator." It is a **cash-pay procedure quote database** for poorly covered procedures, with enough metadata to answer:

> "What have real patients been quoted, what did they actually pay, what was included, and what should I ask for in writing?"

Current tools mostly fail at the exact moment a patient needs them: when the procedure is expensive, coverage is uncertain, the provider quote is opaque, and the patient needs a defensible counter-anchor. That gap is the MVP's target.

---

## Follow-up analysis — why procedure-specific beats general estimator

(Second ChatGPT round, same session, 2026-04-24. Extends the above; non-duplicated points only.)

### There is no existing consumer tool that solves this

ClearHealthCosts' own PriceCheck FAQ says it launched with only **30–35 common shoppable procedures** in **nine metro areas**. ([ClearHealthCosts PriceCheck FAQ][5]) It is structurally not built for long-tail or specialty procedures with weak insurance coverage. A general-purpose national price estimator is the wrong shape for Intracept-class procedures.

### A procedure-specific site has a motivational advantage

Broad healthcare price sites under-cover niche procedures because most submitters don't have enough personal stake to contribute. A **procedure-specific cash-pay quote database** works because the users have a strong reason to contribute — they have either just been quoted, just paid, or are actively shopping.

This reinforces the MVP decision to launch with a single CPT (64628) rather than a procedure picker UI: the landing page itself advertises the specific value prop.

### Regulatory anchoring for the benchmark layer

- **Hospital price transparency rule (CMS):** hospitals must publish machine-readable files with gross charges, discounted cash prices, payer-specific negotiated charges, and de-identified min/max negotiated charges. ([CMS Hospital Price Transparency][6])
- **Transparency in Coverage (DOL):** payer-side negotiated-rate files are designed to expose in-network rates, though they are hard to use without normalization. ([DOL TiC negotiated-rate spec][7])

These are the legal backbone for the ETL work already scoped in `tools/`. Worth citing on any user-facing "where this data comes from" page.

### The useful consumer output is not "average price"

For low-coverage procedures, the useful output is a structured narrative, not a single number. Target something like:

> "Patients have reported written all-in cash quotes between $X and $Y in your region. The lowest documented ASC bundle nationally is $Z. Nearby hospital transparency files show payer-negotiated rates from $A to $B. Ask whether anesthesia, facility, device, imaging, and follow-up are included."

Design implication for the results UI: show a **range with provenance** plus a **checklist prompt of what to ask**, rather than a single "fair price" figure. This aligns with the CLAUDE.md invariant that every rate must show source, year, and caveat.

### Positioning against other tools

- **FAIR Health** — regional consumer estimates across many procedures, but not designed to tell you what a specific provider will accept as a cash bundle. ([FAIR Health Consumer][4])
- **Healthcare Bluebook / Valenz** — closer to "fair price," but access is typically employer/benefit-driven rather than open consumer research. ([Healthcare Bluebook][8])
- **Turquoise / Sage** — better for transparency data than for a patient-friendly cash-shopping workflow.

Crowdsourcing is the missing layer these tools don't fill.

### MVP flow (matches what CLAUDE.md already scopes)

**procedure-specific landing page → anonymous quote submission → optional document upload → moderator normalization → searchable table by provider/geography → benchmark overlays from Medicare + T-in-C data.**

Document upload and moderator normalization are not yet scoped in the current MVP issues — flag as candidates for `v1.1` once submission volume justifies them.

---

## References

[1]: https://www.mdsave.com/ "MDsave - Your Medical Procedure for Less"
[2]: https://clearhealthcosts.com/faq/ "ClearHealthCosts FAQ"
[3]: https://www.brookings.edu/wp-content/uploads/2016/06/Online-Health-Care-Data-SourcesUpdated-6215.pdf "Online Health Care Data Sources (Brookings)"
[4]: https://www.fairhealthconsumer.org/ "FAIR Health Consumer"
[5]: https://clearhealthcosts.com/help-pricecheck-faq/ "ClearHealthCosts PriceCheck FAQ"
[6]: https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency/hospitals "CMS Hospital Price Transparency — Hospitals"
[7]: https://www.dol.gov/sites/dolgov/files/ebsa/pdf_files/transparency-in-coverage-negotiated-rate-file.pdf "DOL Transparency in Coverage — Negotiated Rate MRF spec"
[8]: https://www.healthcarebluebook.com/ui/home "Healthcare Bluebook / Valenz"
