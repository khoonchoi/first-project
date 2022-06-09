// 1. 모듈포함
// 1.1 객체생성
const express = require('express');
const app = express();
const bodyParser = require('body-parser');

const fs = require('fs');
const path = require('path');

// fabric library 가져오기
const FabricCAServices = require('fabric-ca-client');
const { FileSystemWallet, Gateway, X509WalletMixin } = require('fabric-network');

const ccpPath = path.resolve(__dirname, 'connection.json');
const ccpJSON = fs.readFileSync(ccpPath, 'utf8');
const ccp = JSON.parse(ccpJSON);

// 2. 서버설정
const PORT = 3000;
const HOST = "0.0.0.0";

app.use(express.static(path.join(__dirname, 'views')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// 3. HTML 라우팅
// 3.1 / GET 
app.get('/', (request, response) => {
    response.sendFile(__dirname + "/views/index.html");
});

// 5. /admin POST 라우팅 adminid - adminid, adminpasswd-passwd
// 응답 { "result":"success" or "failed", "msg":""}
app.post('/admin', async (req, res) => {
    const adminid = req.body.adminid;
    const adminpasswd = req.body.passwd;

    console.log(adminid, adminpasswd);

    try {
        // 3. ca 접속
        const caURL = ccp.certificateAuthorities['ca.example.com'].url;
        console.log(caURL);
        const ca = new FabricCAServices(caURL);

        // 4. wallet에서 기존 admin 확인
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = new FileSystemWallet(walletPath);
        const adminExists = await wallet.exists(adminid);
        if (adminExists) {
            console.log('An identity for the admin user admin already exists in the wallet');
            var result = '{"result":"failed", "msg":"An identity for the admin user admin already exists in the wallet"}'
            res.json(JSON.parse(result));
            return;
        }
        // 5. admin등록
        const enrollment = await ca.enroll({ enrollmentID: adminid, enrollmentSecret: adminpasswd });

        // 6. 인증서 발급
        const identity = X509WalletMixin.createIdentity('Org1MSP', enrollment.certificate, enrollment.key.toBytes());
        console.log(identity);
        wallet.import(adminid, identity);

        console.log('Successfully enrolled admin user and imported it into the wallet');
        var result = '{"result":"success", "msg":"Successfully enrolled admin user and imported it into the wallet"}'
        res.status(200).json(JSON.parse(result));

    } catch (error) {
        console.error(`Failed to enroll admin user : ${error}`);
        var result = '{"result":"failed", "msg":"Failed to enroll admin user in try/catch"}'
        res.json(JSON.parse(result));
    }
});

// 6. /user POST 라우팅 userid - userid, userrole - role
// 응답 { "result":"success" or "failed", "msg":""}
app.post('/user', async (req, res) => {
    const userid = req.body.userid;
    const userrole = req.body.role;

    try {
        // 3. wallet에서 user1, admin검사
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = new FileSystemWallet(walletPath);
        const userExists = await wallet.exists(userid);
        if (userExists) {
            console.log('An identity for the user already exists in the wallet');
            var result = `{"result":"failed", "msg":"An identity for the user already exists in the wallet - ${userid}"}`
            res.json(JSON.parse(result));
            return;
        }
        const adminExists = await wallet.exists('admin');
        if (!adminExists) {
            console.log('An identity for the admin user does not exist in the wallet');
            return;
        }
        // 4. 게이트웨이에 연결 -> admin identity 가져오기
        const gateway = new Gateway();
        await gateway.connect(ccp, { wallet, identity: 'admin', discovery: { enabled: false } });
        const ca = gateway.getClient().getCertificateAuthority();
        const adminIdentity = gateway.getCurrentIdentity();

        // 5. register -> enroll -> import 
        const secret = await ca.register({ affiliation: 'org1.department1', enrollmentID: userid, role: userrole }, adminIdentity);
        const enrollment = await ca.enroll({ enrollmentID: userid, enrollmentSecret: secret });
        const userIdentity = X509WalletMixin.createIdentity('Org1MSP', enrollment.certificate, enrollment.key.toBytes());
        wallet.import(userid, userIdentity);
        console.log('Successfully registered and enrolled user and imported it into the wallet');
        var result = '{"result":"success", "msg":"Successfully registered and enrolled user and imported it into the wallet"}'
        res.status(200).json(JSON.parse(result));

    } catch (error) {
        console.error(`Failed to enroll user : ${error}`);
        var result = '{"result":"failed", "msg":"Failed to enroll user in try/catch"}'
        res.json(JSON.parse(result));
    }
});

// 4. REST api 라우팅
// 4.1 /asset POST
app.post('/asset', async (request, response) => {
    try {
        const key = request.body.key;
        const value = request.body.value;
        const userid = request.body.userid;

        console.log("/asset-post-", userid, key, value);

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = new FileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        const userExists = await wallet.exists(userid);
        if (!userExists) {
            console.log('An identity for the user  does not exist in the wallet');
            console.log('Run the registerUser.js application before retrying');

            // const resultPath = path.join(process.cwd(), '/views/result.html');
            // var resultHTML = fs.readFileSync(resultPath, 'utf8');
            // resultHTML = resultHTML.replace('<div></div>', '<div><p>Unauthorized connection.</p></div>');
            // response.status(401).send(resultHTML);
            var resultjson = '{"result":"failed", "msg":"An identity for the user  does not exist in the wallet"}'
            response.json(JSON.parse(resultjson));
            return;
        }

        const gateway = new Gateway();
        await gateway.connect(ccp, { wallet, identity: userid, discovery: { enabled: false } });
        const network = await gateway.getNetwork('mychannel');
        const contract = network.getContract('simpleasset');
        await contract.submitTransaction('set', key, value);
        console.log('Transaction has been submitted');

        await gateway.disconnect();

        // const resultPath = path.join(process.cwd(), '/views/result.html');
        // var resultHTML = fs.readFileSync(resultPath, 'utf8');
        // resultHTML = resultHTML.replace('<div></div>', '<div><p>Transaction has been submitted</p></div>');
        // response.status(200).send(resultHTML);
        var resultjson = `{"result":"success", "msg":"Transaction has been submitted"}`;
        response.status(200).json(JSON.parse(resultjson));
    } catch (error) {
        console.error(`Failed to get asset info in try/catch : ${error}`);
        var resultjson = '{"result":"failed", "msg":"Failed to get asset info in try/catch"}'
        response.json(JSON.parse(resultjson));
    }

});

// 4.2 /asset GET

app.get('/asset', async (request, response) => {
    const key = request.query.key;
    const userid = request.query.userid;
    const mode = request.query.mode; // get or history

    console.log("/asset-get-", userid, key, mode);

    try {
        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = new FileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        const userExists = await wallet.exists(userid);
        if (!userExists) {
            console.log('An identity for the user does not exist in the wallet');
            console.log('Run the registerUser.js application before retrying');
            // const resultPath = path.join(process.cwd(), '/views/result.html');
            // var resultHTML = fs.readFileSync(resultPath, 'utf8');
            // resultHTML = resultHTML.replace('<div></div>', '<div><p>Unauthorized connection.</p></div>');
            // response.status(401).send(resultHTML);

            var resultjson = '{"result":"failed", "msg":"An identity for the user does not exist in the wallet"}'
            response.json(JSON.parse(resultjson));
            return;
        }

        const gateway = new Gateway();
        await gateway.connect(ccp, { wallet, identity: userid, discovery: { enabled: false } });

        const network = await gateway.getNetwork('mychannel');
        const contract = network.getContract('simpleasset');

        var cc_func_name = mode;
        
        const result = await contract.evaluateTransaction(cc_func_name, key);
        console.log(`Transaction has been evaluated, result is: ${result.toString()}`);

        // Disconnect from the gateway.
        await gateway.disconnect();

        // const resultPath = path.join(process.cwd(), '/views/result.html');
        // var resultHTML = fs.readFileSync(resultPath, 'utf8');
        // resultHTML = resultHTML.replace('<div></div>', `<div><p>Transaction has been evaluated, result is: ${result.toString()}</p></div>`);
        // response.status(200).send(resultHTML);
        var resultjson = `{"result":"success", "msg":${result.toString()}}`;
        response.status(200).json(JSON.parse(resultjson));
    } catch (error) {
        console.error(`Failed to get asset info in try/catch : ${error}`);
        var resultjson = '{"result":"failed", "msg":"Failed to get asset info in try/catch"}'
        response.json(JSON.parse(resultjson));
    }
});

// 8. 자산 전송 라우팅 /tx POST 
app.post('/tx', async (request, response) => {
    try {
        const fromkey = request.body.fromkey;
        const tokey = request.body.tokey;
        const amount = request.body.amount;
        const userid = request.body.userid;

        console.log("/tx-post-", userid, fromkey, tokey, amount);

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = new FileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        const userExists = await wallet.exists(userid);
        if (!userExists) {
            console.log('An identity for the user  does not exist in the wallet');
            console.log('Run the registerUser.js application before retrying');

            // const resultPath = path.join(process.cwd(), '/views/result.html');
            // var resultHTML = fs.readFileSync(resultPath, 'utf8');
            // resultHTML = resultHTML.replace('<div></div>', '<div><p>Unauthorized connection.</p></div>');
            // response.status(401).send(resultHTML);
            var resultjson = '{"result":"failed", "msg":"An identity for the user  does not exist in the wallet"}'
            response.json(JSON.parse(resultjson));
            return;
        }

        const gateway = new Gateway();
        await gateway.connect(ccp, { wallet, identity: userid, discovery: { enabled: false } });
        const network = await gateway.getNetwork('mychannel');
        const contract = network.getContract('simpleasset');
        await contract.submitTransaction('transfer', fromkey, tokey, amount);
        console.log('Transaction has been submitted');

        await gateway.disconnect();

        // const resultPath = path.join(process.cwd(), '/views/result.html');
        // var resultHTML = fs.readFileSync(resultPath, 'utf8');
        // resultHTML = resultHTML.replace('<div></div>', '<div><p>Transaction has been submitted</p></div>');
        // response.status(200).send(resultHTML);
        var resultjson = `{"result":"success", "msg":"Transaction has been submitted: ${fromkey} -> ${tokey} , ${amount}"}`;
        response.status(200).json(JSON.parse(resultjson));
    } catch (error) {
        console.error(`Failed to tranfer in try/catch : ${error}`);
        var resultjson = '{"result":"failed", "msg":"Failed to tranfer in try/catch"}'
        response.json(JSON.parse(resultjson));
    }

});

// 5 서버 시작
app.listen(PORT, HOST, () => {
    console.log(`Running on http://${HOST}:${PORT}`);
});