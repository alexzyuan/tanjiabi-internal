import assert from "node:assert/strict";
import test from "node:test";
import {
  applyErpBuyerMessageReplyStatus,
  extractAmazonOrderId,
  matchesErpBuyerMessageReply,
} from "../src/services/erpMailReplyMatcher.js";

test("extractAmazonOrderId reads Amazon order ids from subjects", () => {
  assert.equal(
    extractAmazonOrderId("Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)"),
    "111-3958185-1645065",
  );
});

test("matchesErpBuyerMessageReply matches replies sent to original marketplace address", () => {
  assert.equal(matchesErpBuyerMessageReply({
    date: "2026-06-30 14:56:54",
    subject: "Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
    from_address: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
  }, {
    date: "2026-06-30 15:10:00",
    to: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
    subject: "Re: Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
    text: "We have received your message.",
  }), true);
});

test("matchesErpBuyerMessageReply does not match replies sent before the buyer message", () => {
  assert.equal(matchesErpBuyerMessageReply({
    date: "2026-06-30 14:56:54",
    subject: "Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
    from_address: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
  }, {
    date: "2026-06-30 13:10:00",
    to: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
    subject: "Re: Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
  }), false);
});

test("applyErpBuyerMessageReplyStatus marks matched ERP messages as replied", () => {
  const rows = applyErpBuyerMessageReplyStatus([
    {
      webmail_uuid: "buyer-1",
      date: "2026-06-30 14:56:54",
      subject: "Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
      from_address: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
    },
    {
      webmail_uuid: "buyer-2",
      date: "2026-06-30 07:50:34",
      subject: "Product details inquiry from Amazon customer carol (Order: 113-0273723-9215468)",
      from_address: "th6wqr1vf6dr43f@marketplace.amazon.com",
    },
  ], [
    {
      account: "joimew@163.com",
      date: "2026-06-30 15:10:00",
      to: "sz2y5ywh1qg1vhx+133a066e@marketplace.amazon.com",
      subject: "Re: Product details inquiry from Amazon customer Cherri (Order: 111-3958185-1645065)",
    },
  ]);

  assert.equal(rows[0]._replyStatus, "replied");
  assert.equal(rows[0]._replyMailbox, "joimew@163.com");
  assert.equal(rows[1]._replyStatus, "pending");
});
