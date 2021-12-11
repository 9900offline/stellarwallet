/* global _, myApp, round, StellarSdk */

myApp.factory('StellarApi', ['$rootScope', 'StellarHistory', 'StellarOrderbook', 'StellarPath', 'AuthenticationFactory',
  function($rootScope, StellarHistory, StellarOrderbook, StellarPath, AuthenticationFactory) {

    let _balances = {};
    let _closeAccountStream;  // function that closes a stream.
    let _closeTxStream;  // function that closes a stream.
    let _subentry = 0;
    let _server;
    let _passphrase;
    let _timeout = 45;
    let _maxfee = 0;

    const _seq = {
      snapshot : "",
      time : new Date()
    };

    const getAsset = (code, issuer) => {
      if (typeof code == 'object') {
        issuer = code.issuer;
        code = code.code;
      }
      return code == $rootScope.currentNetwork.coin.code ? new StellarSdk.Asset.native() : new StellarSdk.Asset(code, issuer);
    }


    return {

      get address() {
        return AuthenticationFactory.address;
      },
      
      _txbuilder(account, memo, fee) {
        if (fee > _maxfee * 10000000) {
          throw new Error("Max fee too low for network conditions.");
        }
        var option = {
          fee : fee,
          networkPassphrase : _passphrase
        };
        if (memo) {
          option.memo = memo; 
        }
        return new StellarSdk.TransactionBuilder(account, option);
      },

      async _calFee() {
        const feeStats = await _server.feeStats();
        const lastAvg = parseFloat(feeStats.fee_charged.p20);
        const fee = round(lastAvg * 1.02);
        console.log("Fee:", fee);
        return fee;
      },

      _updateSeq(account) {
        const now = new Date();
        // In the same ledger
        if (now - _seq.time < 5000) {
          for (;account.sequence <= _seq.snapshot;) {
            account.incrementSequenceNumber();
            console.debug('Sequence: ' + _seq.snapshot + ' -> ' + account.sequence);
          }
        }
        _seq.snapshot = account.sequence;
        _seq.time = now;
      },

      _fund(target, amount, memo_type, memo_value) {
        amount = round(amount, 7);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const payment = StellarSdk.Operation.createAccount({
              destination: target,
              startingBalance: amount.toString()
            });
            const memo = new StellarSdk.Memo(memo_type, memo_value);
            const tx = this._txbuilder(account, memo, fee).addOperation(payment).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log(`Funded.`, txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Fund Fail !', err);
            reject(err);
          }
        });
      },

      _sendCoin(target, amount, memo_type, memo_value) {
        amount = round(amount, 7);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const payment = StellarSdk.Operation.payment({
              destination: target,
              asset: StellarSdk.Asset.native(),
              amount: amount.toString()
            });
            const memo = new StellarSdk.Memo(memo_type, memo_value);
            const tx = this._txbuilder(account, memo, fee).addOperation(payment).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log(`Send ${$rootScope.currentNetwork.coin.code} done.`, txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Send Fail !', err);
            reject(err);
          }
        });
      },

      _sendToken(target, currency, issuer, amount, memo_type, memo_value) {
        amount = round(amount, 7);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const payment = StellarSdk.Operation.payment({
              destination: target,
              asset: new StellarSdk.Asset(currency, issuer),
              amount: amount.toString()
            });
            const memo = new StellarSdk.Memo(memo_type, memo_value);
            const tx = this._txbuilder(account, memo, fee).addOperation(payment).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Send Asset done.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Send Fail !', err);
            reject(err);
          }
        });
      },

      _updateRootBalance(balances = _balances) {
        let native = 0;
        const lines = {};

        balances.forEach((line) => {
          if (line.asset_type == 'native') {
            native = parseFloat(line.balance);
          } else {
            if (!lines[line.asset_code]) {
              lines[line.asset_code] = {};
            }
            const item = {
              code : line.asset_code,
              issuer : line.asset_issuer,
              balance : parseFloat(line.balance),
              limit : parseFloat(line.limit)
            };
            lines[line.asset_code][line.asset_issuer] = item;
          }
        });
        console.log('lines', lines);
        $rootScope.balance = native;
        $rootScope.lines = lines;
        $rootScope.$broadcast("balanceChange");
      },

      _offer(type, selling, buying, amount, price) {
        amount = round(amount, 7);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            let op;
            if (type == 'buy') {
              op = StellarSdk.Operation.manageBuyOffer({
                selling: selling,
                buying: buying,
                buyAmount: amount.toString(),
                price : price.toString()
              });
            } else {
              op = StellarSdk.Operation.manageSellOffer({
                selling: selling,
                buying: buying,
                amount: amount.toString(),
                price : price.toString()
              });
            }
            
            const tx = this._txbuilder(account, null, fee).addOperation(op).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Offer done.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Offer Fail !', err);
            reject(err);
          }
        });
      },

      _closeStream() {
        if (_closeAccountStream) {
          _closeAccountStream();
          _closeAccountStream = undefined;
        }
        if (_closeTxStream) {
          _closeTxStream();
          _closeTxStream = undefined;
        }
      },

      logout() {
        this.address = undefined;
        _balances = {};
        _subentry = 0;
        _seq.snapshot = "";
        _seq.time = new Date();
        this._closeStream();
        StellarOrderbook.close();
        StellarPath.close();
      },

      isValidAddress(address) {
        return StellarSdk.StrKey.isValidEd25519PublicKey(address);
      },

      federation(fed_url) {
        return StellarSdk.StellarTomlResolver.resolve(fed_url);
      },

      setServer(url, passphrase, allowHttp=false) {
        if(!url) throw new Error('No URL')
        console.debug("Use Network: " + url + ', Passphrase: ' + passphrase);
        _server = new StellarSdk.Server(url, {allowHttp});
        _passphrase = passphrase;
        StellarHistory.setServer(_server, _passphrase);
        StellarOrderbook.setServer(_server);
        StellarPath.setServer(_server);
      },

      setTimeout(timeout) {
        _timeout = parseFloat(timeout);
      },
      setMaxfee(maxfee) {
        _maxfee = parseFloat(maxfee);
      },

      isValidMemo(type, memo) {
        try {
          new StellarSdk.Memo(type, memo);
          return '';
        } catch (e) {
          return e.message;
        }
      },

      send(target, currency, issuer, amount, memo_type, memo_value) {
        amount = round(amount, 7);
        console.debug(target, currency, issuer, amount, memo_type, memo_value);
        if (currency !== $rootScope.currentNetwork.coin.code) {
          return this._sendToken(target, currency, issuer, amount, memo_type, memo_value);
        }

        //Send native asset
        return new Promise(async (resolve, reject)=>{
          try {
            const accountResult = await _server.accounts().accountId(target).call();
            const hash = await this._sendCoin(target, amount, memo_type, memo_value);
            resolve(hash);
          } catch (err) {
            if (err instanceof StellarSdk.NotFoundError) {
              this._fund(target, amount, memo_type, memo_value).then(hash =>{
                resolve(hash);
              }).catch(err => {
                reject(err);
              });              
            } else {
              reject(err);
            }            
          }
        });
      },

      convert(alt) {
        console.debug(alt.origin.source_amount + '/' + alt.src_code + ' -> ' + alt.origin.destination_amount + '/' + alt.dst_code);
        const path = alt.origin.path.map((item) => {
          if (item.asset_type == 'native') {
            return new StellarSdk.Asset.native();
          } else {
            return new StellarSdk.Asset(item.asset_code, item.asset_issuer);
          }
        });
        let sendMax = alt.origin.source_amount;
        if (alt.max_rate) {
          sendMax = round(alt.max_rate * sendMax, 7).toString();
        }

        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const pathPayment = StellarSdk.Operation.pathPaymentStrictReceive({
              destination: this.address,
              sendAsset  : getAsset(alt.src_code, alt.src_issuer),
              sendMax    : sendMax,
              destAsset  : getAsset(alt.dst_code, alt.dst_issuer),
              destAmount : alt.origin.destination_amount,
              path       : path
            });
            const tx = this._txbuilder(account, null, fee).addOperation(pathPayment).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Convert done.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Convert Fail !', err);
            reject(err);
          }
        });        
      },

      listenStream() {
        this._closeStream();

        console.log(this.address, _server.accounts().accountId(this.address))
        _closeAccountStream = _server.accounts().accountId(this.address).stream({
          onmessage: (res) => {
            if (_subentry !== res.subentry_count) {
              console.debug('subentry: ' + _subentry + ' -> ' + res.subentry_count);
              _subentry = res.subentry_count;
              $rootScope.reserve = _subentry * 0.5 + 1;
              $rootScope.$apply();
            }
            if(!_.isEqual(_balances, res.balances)) {
              console.debug('balances: ', _balances, res.balances);
              _balances = res.balances;
              this._updateRootBalance();
              $rootScope.$apply();
            }
          }
        });

        // TODO: parse the tx and do action
        _closeTxStream = _server.transactions().forAccount(this.address)
          .cursor("now")
          .stream({
            onmessage: (res) => {
              const tx = StellarHistory.processTx(res, this.address);
              console.log('tx stream', tx);
            }
          });
      },

      getInfo(address) {
        return new Promise(async (resolve, reject)=>{
          try {
            const data = await _server.accounts().accountId(address||this.address).call();
            resolve(data);
          } catch (err) {
            if (!(err instanceof StellarSdk.NotFoundError)) {
              console.error(address, err);
            }
            reject(err);
          }
        });
      },

      changeTrust(code, issuer, limit) {
        const asset = new StellarSdk.Asset(code, issuer);
        console.debug('Turst asset', asset, limit);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const op = StellarSdk.Operation.changeTrust({
              asset: asset,
              limit: limit.toString()
            });
            const tx = this._txbuilder(account, null, fee).addOperation(op).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Trust updated.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Trust Fail !', err);
            reject(err);
          }
        });
      },

      setOption(name, value) {
        const opt = {};
        opt[name] = value
        console.debug('set option:', name, '-', value);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const op = StellarSdk.Operation.setOptions(opt);
            const tx = this._txbuilder(account, null, fee).addOperation(op).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Option updated.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Option Fail !', err);
            reject(err);
          }
        });
      },

      setData(name, value) {
        const opt = {name: name, value: value? value : null};
        console.debug('manageData:', name, '-', value);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const op = StellarSdk.Operation.manageData(opt);
            const tx = this._txbuilder(account, null, fee).addOperation(op).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Data updated.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Data Fail !', err);
            reject(err);
          }
        });
      },

      claim(balanceId) {
        const opt = {balanceId: balanceId};
        console.debug('Claim:', balanceId);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const op = StellarSdk.Operation.claimClaimableBalance(opt);
            const tx = this._txbuilder(account, null, fee).addOperation(op).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Balance claimed.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Claim Fail !', err);
            reject(err);
          }
        });
      },

      merge(destAccount) {
        const opt = {destination: destAccount};
        console.debug('merge:', this.address, '->', destAccount);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const op = StellarSdk.Operation.accountMerge(opt);
            const tx = this._txbuilder(account, null, fee).addOperation(op).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Account merged.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('accountMerge Fail !', err);
            reject(err);
          }
        });
      },

      queryAccount(callback) {
        console.debug('query', this.address);
        this.getInfo(this.address, (err, data) => {
          if (err) {
            if (callback) { callback(err); }
            return;
          }
          _balances = data.balances;
          _subentry = data.subentry_count;
          $rootScope.reserve = _subentry * 0.5 + 1;
          this._updateRootBalance();
          $rootScope.$apply();
          if (callback) { callback(); }
          return;
        });
      },

      queryClaim(callback) {
        console.debug('queryClaimable', this.address);
        _server.claimableBalances().claimant(this.address).limit(200).order("desc").call().then(balance => {
          console.log(balance);
          if (callback) { callback(null, balance); }
        }).catch(function(err) {
          console.error(`Claimable balance retrieval failed: ${err}`);
          if (callback) { callback(err); }
        });
      },

      queryPayments(callback) {
        console.debug('payments', this.address);
        StellarHistory.payments(this.address, callback);
      },

      queryPaymentsNext(addressOrPage, callback) {
        console.debug('loop payments', this.address);
        StellarHistory.payments(addressOrPage, callback);
      },

      queryEffects(callback) {
        console.debug('effects', this.address);
        StellarHistory.effects(this.address, callback);
      },

      queryEffectsNext(addressOrPage, callback) {
        console.debug('loop effects', this.address);
        StellarHistory.effects(addressOrPage, callback);
      },

      queryTransactions(callback) {
        console.debug('transactions', this.address);
        StellarHistory.transactions(this.address, callback);
      },

      queryTransactionsNext(page, callback) {
        console.debug('loop transactions');
        StellarHistory.transactions(page, callback);
      },

      queryBook(baseBuy, counterSell, callback) {
        StellarOrderbook.get(baseBuy, counterSell, callback);
      },

      listenOrderbook(baseBuying, counterSelling, handler) {
        StellarOrderbook.listen(baseBuying, counterSelling, handler);
      },

      closeOrderbook() {
        StellarOrderbook.close();
      },

      queryPath(src, dest, code, issuer, amount, callback) {
        StellarPath.get(src, dest, code, issuer, amount, callback);
      },

      listenPath(src, dest, code, issuer, amount, handler) {
        StellarHistory.listen(src, dest, code, issuer, amount, handler);
      },

      closePath() {
        StellarHistory.close();
      },

      queryOffer(callback) {
        console.debug('offers', this.address);
        _server.offers().forAccount(this.address).limit(200).call().then((data) => {
          console.log('offers', data.records);
          callback(null, data.records);
        }).catch((err) => {
          console.error('QueryOffer Fail !', err);
          callback(err, null);
        });
      },

      offer(option,) {
        console.debug('%s %s %s use %s@ %s', option.type, option.amount, option.code, option.counter, option.price);
        let buying, selling;

        if (option.type == 'buy') {
          selling = getAsset(option.counter, option.counter_issuer);
          buying  = getAsset(option.code, option.issuer);
        } else {
          selling = getAsset(option.code, option.issuer);
          buying  = getAsset(option.counter, option.counter_issuer);
        }
        return this._offer(option.type, selling, buying, option.amount, option.price);
      },

      cancel(offer) {
        let selling, buying, price, offer_id;
        if (typeof offer === 'object') {
          selling = offer.selling;
          buying  = offer.buying;
          price   = round(offer.price, 7);
          offer_id = offer.id;
        } else {
          selling = StellarSdk.Asset.native();
          buying  = new StellarSdk.Asset('DUMMY', this.address);
          price   = "1";
          offer_id = offer;
        }
        console.debug('Cancel Offer', offer_id);
        return new Promise(async (resolve, reject)=>{
          try {
            const account = await _server.loadAccount(this.address);
            const fee = await this._calFee();
            this._updateSeq(account);

            const op = StellarSdk.Operation.manageSellOffer({
              selling: selling,
              buying: buying,
              amount: "0",
              price : price,
              offerId : offer_id
            });
            const tx = this._txbuilder(account, null, fee).addOperation(op).setTimeout(_timeout).build();
            const te = await AuthenticationFactory.sign(tx);
            const txResult = await _server.submitTransaction(te);
            console.log('Cancel done.', txResult);
            resolve(txResult.hash);
          } catch (err) {
            console.error('Cancel Fail !', err);
            reject(err);
          }
        });
      },

      getFedName(domain, address, callback) {
        StellarSdk.FederationServer.createForDomain(domain).then((server) => {
          return server.resolveAccountId(address);
        })
        .then((data) => {
          if(data.stellar_address) {
            const index = data.stellar_address.indexOf("*");
            const fed_name = data.stellar_address.substring(0, index);
            return callback(null, fed_name);
          }
        }).catch((err) => {
          return callback(err);
        });
      },

      getErrMsg(err) {
        let message = "";
        if (err instanceof StellarSdk.NotFoundError) {
          message = "NotFoundError";
        } else if (err.response && err.response.data && err.response.data.extras && err.response.data.extras.result_xdr) {
          const resultXdr = StellarSdk.xdr.TransactionResult.fromXDR(err.response.data.extras.result_xdr, 'base64');
          if (resultXdr.result().results()) {
            message = resultXdr.result().results()[0].value().value().switch().name;
          } else {
            message = resultXdr.result().switch().name;
          }
        } else {
          message = err.detail || err.message;
        }
        console.warn(getErrCode(err));
        if (!message) console.error("Fail in getErrMsg", err);
        return message;
      },

    };
  } ]);

function getErrCode(error) {
  if (error.error) {
      return error.error;
  }
  if (!error.response) {
      return error.toString();
  }
  const { data } = error.response;
  if (!data) {
      return `clientError - ${error.message}`;
  }
  if (!data.extras || !data.extras.result_codes) {
      return `unknownResponse - ${error.message}`;
  }
  if (data.extras.result_codes.transaction === 'tx_failed') {
      return data.extras.result_codes.operations.find(op => op !== 'op_success');
  }
  return data.extras.result_codes.transaction;
}

/* exported b64DecodeUnicode */
const b64DecodeUnicode = (str) => {
  const encodedURIComponent = atob(str)
    .split('')
    .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
    .join('');
  return decodeURIComponent(encodedURIComponent);
}
