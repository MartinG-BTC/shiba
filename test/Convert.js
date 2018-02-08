const { parser } = require("../Cmd/ConvertParser")

function test(str) {
  var res = parser.parse(str);
  console.log(str, '->', res);
}

test('2 btc');
test('2 btc to usd');
test('2k btc usd');
test('mBTC $ 2');
test('GBP GBP 3');
test('2 AUD');
test('2 USD');
test('2 GBP');
test('2k bits');
test('1.23k USD');
test('€2k to $');
