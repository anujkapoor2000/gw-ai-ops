import { findMatch } from './kb';

test('requires a meaningful signal before returning a runbook', function() {
  expect(findMatch('npe')).toBeNull();
});

test('returns a matching runbook for specific incident descriptions', function() {
  var match = findMatch('BillingCenter ACH payment gateway timeout with NPE');
  expect(match).not.toBeNull();
  expect(match.id).toBe('KB-002');
});

test('bounds oversized incident descriptions before matching', function() {
  var oversized = 'x'.repeat(2500) + ' BillingCenter ACH payment gateway timeout';
  expect(findMatch(oversized)).toBeNull();
});
