# Domain operations

Operational record for `stareaparaty.com`. Keep account credentials, payment
details, registrant contact data, and authorization/EPP codes out of this
repository.

## Registration

Last checked against the `.com` registry on **2026-08-26**.

| Field | Value |
| --- | --- |
| Domain | `stareaparaty.com` |
| Losing registrar | Namecheap, Inc. |
| New registrar | Cloudflare Registrar |
| Transfer | Initiated 2026-08-26; registry status `pendingTransfer` |
| Current expiry | 2026-09-23 |
| Expected expiry after transfer | 2027-09-23 |
| Authoritative nameservers | `vasilii.ns.cloudflare.com`, `yolanda.ns.cloudflare.com` |
| DNSSEC during transfer | Disabled (`delegationSigned: false`) |

The transfer includes a one-year registration extension. Because the site was
already using Cloudflare's authoritative nameservers, the registrar transfer
does not require a DNS change and should not interrupt the site or email.

## Completion checklist

- [ ] Cloudflare's **Domain Registration > Transfer Domains** page reports the
      transfer as complete.
- [ ] Public RDAP reports Cloudflare as registrar and no longer reports
      `pendingTransfer`.
- [ ] The registry expiry is 2027-09-23.
- [ ] `https://stareaparaty.com/` and `support@stareaparaty.com` still work.
- [ ] Enable DNSSEC in Cloudflare after the transfer, then confirm the registry
      reports `delegationSigned: true`.
- [ ] Choose the desired auto-renew setting and schedule a renewal-value review
      no later than 2027-08-23.

Cloudflare notes that registrar transfers can take up to ten days, with the
losing registrar normally taking up to five days to release a domain. If this
transfer fails, request a new authorization code before retrying; never reuse or
commit an exposed code.

## Verification

Registry record:
<https://rdap.verisign.com/com/v1/domain/STAREAPARATY.COM>

Cloudflare transfer procedure:
<https://developers.cloudflare.com/registrar/get-started/transfer-domain-to-cloudflare/>

Namecheap transfer-out procedure:
<https://www.namecheap.com/support/knowledgebase/article.aspx/258/84/what-should-i-do-to-transfer-a-domain-from-namecheap/>
