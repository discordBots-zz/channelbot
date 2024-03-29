var Discord = require("discord.js");
var bot = new Discord.Client({forceFetchUsers:true});

var TULING = require('tuling');
var tuling = new TULING({key: 'dee7e4eb721e2163f8c0436bf61a6fa1'});

var Request = require("request");
var RequestPromise = require('request-promise');
var Cheerio = require('cheerio');

var _ = require('lodash');
var CronJob = require('cron').CronJob;

var OpenCC = require('node-opencc');

var Columnify = require('columnify')

var TravelerData = require('./comments.js');
var Festivals = require('./festivals.js')
var Translate = require('./translate.js');
var MsTranslator = require('mstranslator');
//TO DO LIST: Check to make sure that NULL fields are given either: Empty String or []
//Every update to mongodb should UPDATE the array of total trackedItems
//Carry out matching in Cron

var express = require('express');
var bodyParser= require('body-parser');
var app = express();

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

var server_port = process.env.OPENSHIFT_NODEJS_PORT || 8080;
var server_ip_address = process.env.OPENSHIFT_NODEJS_IP || "127.0.0.1";

app.listen(server_port, server_ip_address, function() {

});

app.get('/', function(req, res) {
  res.send('正在运行')
})
/*
To connect using the mongo shell:
mongo ds013456.mlab.com:13456/dictionary -u <dbuser> -p <dbpassword>
To connect using a driver via the standard MongoDB URI (what's this?):
  mongodb://<dbuser>:<dbpassword>@ds013456.mlab.com:13456/dictionary

<dbuser> = mlabguildwars1
<dbpassword> = mlabguildwars1
*/
// default to a 'localhost' configuration:
var connection_string = '127.0.0.1:27017/discordapp';
var collections = ['discordUsers', 'adTable', 'messageLog'];
// if OPENSHIFT env variables are present, use the available connection info:
if(process.env.OPENSHIFT_MONGODB_DB_PASSWORD){
  connection_string = process.env.OPENSHIFT_MONGODB_DB_USERNAME + ":" +
  process.env.OPENSHIFT_MONGODB_DB_PASSWORD + "@" +
  process.env.OPENSHIFT_MONGODB_DB_HOST + ':' +
  process.env.OPENSHIFT_MONGODB_DB_PORT + '/' +
  process.env.OPENSHIFT_APP_NAME;
}


var mongojs = require('mongojs');
var UserDB = mongojs(connection_string, collections);

function discordUser(userID, userName, clientID, clientSecret, trackedItems){
  this.userID = userID;
  this.userName = userName;
  this.clientID = clientID;
  this.clientSecret = clientSecret;
  this.trackedItems = trackedItems;
  this.changeName = function(name){
    this.userName=name;
  }
}

function adItem(itemName, interestedParty){
  this.itemName = itemName;
  this.interestedParty = interestedParty;
}

UserDB.discordUsers.dropIndex({userID : 1});
UserDB.discordUsers.ensureIndex({userID : 1}, {unique:true, dropDups : true});

UserDB.adTable.dropIndex({itemName : 1});
UserDB.adTable.ensureIndex({itemName : 1}, {unique:true, dropDups : true});

//UserDB.messageLog.dropIndex({receivedOn : 1});
UserDB.messageLog.ensureIndex( { receivedOn: 1 }, { expireAfterSeconds:  15811200} );

bot.on("ready", function() {
  var userList = bot.users;
  var validUsers = []
  for (i = 0; i < userList.length; i++) {
    validUsers.push(userList[i].id);
  }

  UserDB.discordUsers.remove({ userID: { $nin: validUsers } });
  UserDB.adTable.update({},{ $pull: { interestedParty: { $nin: validUsers}}},{ multi: true });
  //in case the above fails to delete properly, try the following
  /*
  var query = {};
  var query_op = {};
  query_op["$nin"] = validUsers;
  query["userID"] = query_op;
  UserDB.discordUsers.remove(query);
  */
});



var zaishenFlag = 0;
var sandfordFlag = 0;
var travelerFlag = 0;

var TrackingLimit = 10;
//var TrackingDB = {};


var weeklyBonus1 = ["Extra Luck Bonus", "Elonian Support Bonus", "Zaishen Bounty Bonus", "Factions Elite Bonus", "Northern Support Bonus", "Zaishen Mission Bonus", "Pantheon Bonus", "Faction Support Bonus", "Zaishen Vanquishing Bonus"];
var weeklyBonus2 = ["Random Arenas Bonus", "Guild Versus Guild Bonus", "Competitive Mission Bonus", "Heroes' Ascent Bonus", "Codex Arena Bonus", "Alliance Battle Bonus"];

var CommandTable = {
  '\'!说明\'':'\'指令说明\'',
  '\'!激战\'':'\'每日活动+节日表\'',
  '\'!地下\'':'\'地下技能板 及 视频链接\'',
  '\'!四门\'':'\'四门技能板 及 视频链接\'',
  '\'!灾难\'':'\'灾难技能板 及 视频链接\'',
  '\'!其他快速团\'':'\'技能板 及 视频链接\'',
  '\'!清频道\'':'\'清空上一百条留言 (需管理员权限)\'',
  '\'!广告+\'':'\'增加跟踪项目 | 各项间以逗号分开，十项为限 | [=例=]: !广告+ 蛋糕, 鸡蛋, 粟米糖\'',
  '\'!广告-\'':'\'删减跟踪项目 | 各项间以逗号分开          | [=例=]: !广告- 蛋糕, 鸡蛋, 粟米糖\'',
  '\'!广告0\'':'\'清除各跟踪项目 | 注: 无尾缀时, !广告+ 及 !广告- 分别为广告频道的开关\'',
  '\'!监控表\'':'\'现跟踪项目\'',
  '\'!查询\'':'\'近期商品价钱  | 限一项, 限字母拼写 | [=例=]: !查询 golden eggs\'',
  '\'!![语言1][语言2]\'':'\'翻译，此指令以双感叹号(!!)开头 | [=例=]: !!中法 早上好\'',
  '\'\'':'\'[语言选择: 中简繁德英西法葡俄]\'',
  '\'\'':'\'[指令亦可以三感叹号(!!!)开头，以把译文发向私聊频道 | [=例=]: !!!中法 早上好]\'',
  '\'!翻译安装\'': '\'见: http://ally.boards.net/thread/12/ | 用法: !翻译安装 帐号名, 密码\''
}
//2 things to do, 查询reverse order + don't delete msg if you're in private
//"+Columnify(CommandTable, {columns: ['指令', '说明']})+"
var Greetings = "```[欢迎来到 -激战- 语言频道]```\n\
```‘自答器’为一中文(简+繁)聊天工具。\n\
发给‘自答器’的语句应以感叹号(!)开头。\n\n\
激战指令: (对已附语言标签的众人开放) (结尾加@[昵称]时可转发于他人 (翻译除外)):```\n\
```xl\n\
'!说明'               '指令说明'\n\
'!激战'               '每日活动+节日表'\n\
'!地下'               '地下技能板 及 视频链接'\n\
'!四门'               '四门技能板 及 视频链接'\n\
'!灾难'               '灾难技能板 及 视频链接'\n\
'!其他快速团'          '技能板 及 视频链接'\n\
'!清频道'             '清空上一百条留言 (需管理员权限)'\n\
'!广告+'              '增加跟踪项目 | 各项间以逗号分开，十项为限 | [=例=]: !广告+ 蛋糕, 鸡蛋, 粟米糖'\n\
'!广告-'              '删减跟踪项目 | 各项间以逗号分开          | [=例=]: !广告- 蛋糕, 鸡蛋, 粟米糖'\n\
'!广告0'              '清除各跟踪项目 | 注: 无尾缀时, !广告+ 及 !广告- 分别为广告频道的开关'\n\
'!监控表'             '现跟踪项目'\n\
'!查询'               '近期商品价钱  | 限一项, 限字母拼写 | [=例=]: !查询 golden eggs'\n\
'!![语言1][语言2]'    '翻译，此指令以双感叹号(!!)开头 | [=例=]: !!中法 早上好'\n\
''                    '[语言选择: 中简繁德英西法葡俄]'\n\
''                    '[指令亦可以三感叹号(!!!)开头，以把译文发向私聊频道 | [=例=]: !!!中法 早上好]'\n\
'!翻译安装'           '见: http://ally.boards.net/thread/12/ | 用法: !翻译安装 帐号名, 密码'\n\
```\n"+"```js\n‘Aethex’为一字母版聊天工具。\n\
发给‘Aethex’的语句应以短杠(-)开头。\n\n \
部分指令:\n\
'-play [曲名]'    '以播放音乐'\n\
'-stop'           '以停止在播曲段'\n\
'-help'           '其他指令'```\n\n";

var GreetingsFrgn = "```[Welcome to the server]```\n\
```‘channelBot’ is a bot.\n\
Messages intended for ‘channelBot’ should begin with an exclamation mark (!).\n\n\
Guildwars commands: [=case insensitive=] [A single @[username] may be attached at the end to redirect results, not applicable to translations]:```\n\
```\n\
'!help'            'Show Commands'\n\
'!guildwar(s)'     'Daily Activities and Festivals'\n\
'!uw or !uwsc'     'UW Templates and Video Links'\n\
'!doa or !doasc'   'Doa Templates and Video Links'\n\
'!fow or !fowsc'   'Fow Templates and Video Links'\n\
'!othersc'         'Templates and Video Links'\n\
'!prune'           'Clear Last 100 Messages (Requires Admin)'\n\
'!![lang1][lang2]' 'Translator, this command begins with 2 exclamation marks (!!) | [=E.g.=]: !!EnCn Good morning'\n\
''                 '[Supported Language Codes: cn, cs, ct, de, en, es, fr, pt, ru]'\n\
''                 '[Command may also begin with 3 exclamation marks (!!!), in order to display results privately]'\n\
'!setTranslate'    'Usage: !setTranslate clientID, clientSecret'\n\
''                 'See: http://ally.boards.net/thread/13/translator-setup'```\n\
```\n‘Aethex’ is a bot.\n\
Messages intended for ‘Aethex’ should begin with a dash (-).\n\n\
Commands include:\n\
'-play [name_of_song]'    'to begin playing music'\n\
'-stop'                   'to stop current broadcast'\n\
'-help'                   'show other commands'```\n\n";

var outputText = "";
var outputText1 = "";
var outputText2 = "";
var outputText3 = "";
var tempOutput = "";
var arrayLength = 0;
var styledOutput = "";
var savedOutput = "";

var outputTextFrgn = "";
var outputText1Frgn = "";
var outputText2Frgn = "";
var outputText3Frgn = "";
var styledOutputFrgn = "";
var savedOutputFrgn = "";

//To find the channel id of a particular text channel:
//bot.sendMessage(message, message.channel.id);
//206905174525083653 channel id of current #100

//To find the role id of a particular role:
/*
var checklist = ""
for (i=0;i<12;i++){//enter total number of roles here
  checklist = checklist + bot.servers[0]['roles'][i].id+"|"+bot.servers[0]['roles'][i].name +"\n"
}
bot.sendMessage(message,checklist)
*/
//servers[0] to [n], servers that this bot is in
//['roles'], roles contained in that server, index 0 is reserved for @everyone, index n follows the order of creation
/*
  if (message.author.hasRole('193510847262228480')){
  };
  193286224390258688|@everyone
  193510847262228480|admin
  193510852756766720|guest
  200126434210086912|bot
  202601311726862336|Bot Commander
  207292976404234241|chinese
  207293097976135680|foreign
  214643873111080960|uw
  214643897123471361|fow
  214643918975795200|doa
  216869990438141953|ckamadan
  216873932635111425|fkamadan


  191679101805789185|@everyone
192756853753643019|Admin
192756879342960642|Role 1
192760303614820363|Bot Commander
192760322686320640|New Role
192760728543952897|Bot
192773738746347521|New Role
192773806559985664|New Role
192773969567285248|New Role
192774019257335808|New Role
192774076807249920|New Role
192774100467318785|New Role
*/

var roleIDAdmin = '192756853753643019'; //changed
var roleIDChinese = '207292976404234241';
var roleIDBot = '200126434210086912';
var roleIDOtherLang = '192756879342960642';//changed
var roleIDKamadanChinese = '216869990438141953';
var roleIDKamadanFrgn = '216873932635111425';
var roleIDGuest = '193510852756766720';
var roleIDBotCommander = '202601311726862336';

var botID = '20229458812312344935ddddddddddd7824'; //changed
var kamadanTextChannel = '209153704820080640';
var kamadanTextChannelFrgn = '218530286655373312'; //changed

bot.on("message",function(message)
{
  if (message.author.bot){
    return 2;
  }

  UserDB.messageLog.insert({receivedOn: new Date(),"userName": message.author.name,"userID": message.author.id,"messageSent": message.content});

  if (!message.author.hasRole(roleIDOtherLang)){
    return 1;
  }

  var tbText = message.content;

  //Carry out other filters here
  /*
  var banKick = false;
  for (t=0;t<pFilter.length;t++){
    var re = new RegExp(pFilter[t], 'gi');
    if (tbText.match(re)){
      banKick = true;
      if (!message.channel.isPrivate) {bot.deleteMessage(message);}
      return 11;
    }
    //tbText = tbText.replace(re, "");
  }
  */

  if (tbText.match(/^[\s.。，；;,?？!！]*$/gi)){
    if (!message.channel.isPrivate) {bot.deleteMessage(message);}
    return 10;
  }

  /*
  if (banKick) {
    //get violation history
    bot.banMember(message.author, bot.servers[0], 180);
    bot.kickMember(message.author, bot.servers[0]);
  }
  */

  if(tbText.charAt(0) === "!" || tbText.charAt(0) === "！")
  {
    //strip ! operator
    var tbText = tbText.substr(1);

    if ((tbText.match(/^激战/gi) || tbText.match(/^激戰/gi) || tbText.match(/^guildwars*?/gi))){

      var tTargetUser = message.mentions[0];

      var selectUser = message.author;

      var compareID1 = selectUser.id;

      if (tTargetUser){
        selectUser = tTargetUser;
      }

      var compareID2 = selectUser.id;

      var lang = '中文';
      if (selectUser.hasRole(roleIDOtherLang)){
        lang = '他文';
      }
      //if (compareID1 !== compareID2) {
        //bot.sendMessage(message, (lang === '中文')?'详见私聊':'详见私聊 (See Private Chat)');
      //}
      scrapeDailyInfo(selectUser, lang, "", "");
      if (!message.channel.isPrivate) {bot.deleteMessage(message);}
    } else if ((tbText.match(/^地下/gi) || tbText.match(/^地下/gi) || tbText.match(/^uw(sc)*?/gi))){
      clearStorage();
      TemplateSender(message, '地下');
    } else if ((tbText.match(/^四门/gi) || tbText.match(/^四門/gi) || tbText.match(/^doa(sc)*?/gi))){
      clearStorage();
      TemplateSender(message, '四门');
    } else if ((tbText.match(/^灾难/gi) || tbText.match(/^災難/gi) || tbText.match(/^fow(sc)*?/gi))){
      clearStorage();
      TemplateSender(message, '灾难');
    } else if ((tbText.match(/^其他快速团/gi) || tbText.match(/^其他快速團/gi) || tbText.match(/^otherscs*?/gi))){
      clearStorage();
      TemplateSender(message, '其他');
    } else if ((tbText==="清频道") || (tbText === '清頻道') || (tbText.toUpperCase() === 'prune'.toUpperCase())){
      clearStorage();
      if (message.author.hasRole(roleIDAdmin)){
        bot.getChannelLogs(message.channel, 100).then(function(data){
          if (!message.channel.isPrivate) {bot.deleteMessages(data);}
        }).catch(function(error){bot.sendMessage(message, "失败: 清除失败")});
      }
    } else if ((tbText.match(/^说明/gi) || tbText.match(/^說明/gi) || tbText.match(/^help/gi))){
      clearStorage();
      var tAuthor = message.author;
      var tTargetUser = message.mentions[0];
      if (!message.channel.isPrivate) {bot.deleteMessage(message);}

      if (tTargetUser){

        if (tTargetUser.hasRole(roleIDOtherLang)) {

          bot.sendMessage(tTargetUser, GreetingsFrgn).then(function(stuff){
            //displayTrackedItems(tTargetUser);
          })
        }
      } else {
        if (tAuthor.hasRole(roleIDOtherLang)) {
          bot.sendMessage(tAuthor, GreetingsFrgn).then(function(stuff){
            //displayTrackedItems(tAuthor);
          })
        }
      }

    } else if (tbText.match(/^[!！]/gi)){
      clearStorage();
      var tAuthor = message.author;
      var tAuthorID = message.author.id;

      tbText = tbText.replace(/^[!！]/gi, "");
      var textSource = "";
      var textDest = "";
      var sendDirect = false;
      if (tbText.match(/^[!！]/gi)){
        sendDirect = true;
        tbText = tbText.replace(/^[!！]/gi, "");
      }
      if (tbText.match(/^[中简繁德英西法葡俄中簡繁德英西法葡俄]/gi)){
        textSource = tbText.charAt(0);
        textDest = tbText.charAt(1);
        tbText = tbText.substring(2, tbText.length);
      } else {
        textSource = tbText.substring(0, 2);
        textDest = tbText.substring(2, 4);
        tbText = tbText.replace(/^.{0,4}/gi, "");
      }
      //tbText = tbText.replace(/^\s*/gi,"");
      var putbackSource = textSource;
      var putbackDest = textDest;
      textSource = langCode(textSource, 0);
      textDest = langCode(textDest, 0);

      UserDB.discordUsers.find({userID:tAuthorID}, function(err, users){
        if ((err) || !(users.length) || !(users[0]["clientID"]) || !(users[0]["clientSecret"]) || (users[0]["clientID"] == "") || (users[0]["clientSecret"] == "")) {
            if (!message.channel.isPrivate) {bot.deleteMessage(message);}
            if (tAuthor.hasRole(roleIDOtherLang)) {
              bot.sendMessage(tAuthor, "Follow link below to obtain 'clientID' and 'clientSecret', then use the following command to update your profile: !setTranslate clientID, clientSecret\nhttp://ally.boards.net/thread/13/translator-setup\n");
            }
        } else {
            var storedSourceLang = users[0]["sourceLang"];
            var storedDestLang = users[0]["destLang"];
            var recordExists = false;
            if (!storedDestLang || !storedSourceLang || storedDestLang == "" || storedSourceLang == ""){
              recordExists = false;
            } else {
              recordExists = true;
            }
            if (((textSource === "error")||(textDest==="error")) && !recordExists){

                if (!message.channel.isPrivate) {bot.deleteMessage(message);}
                if (tAuthor.hasRole(roleIDOtherLang)) {
                  bot.sendMessage(tAuthor, "[Error: Reenter language codes: cn, cs, ct, de, en, es, fr, pt, ru]");
                }
            } else {

              if ((textSource === "error")||(textDest==="error")){
                textSource = storedSourceLang;
                textDest = storedDestLang;
                //console.log(putbackSource)
                //console.log(putbackDest)
                //console.log(tbText)
                tbText = putbackSource + putbackDest + tbText;
                //console.log(tbText)
              } else {
                UserDB.discordUsers.update({userID:tAuthorID}, {$set:{sourceLang:textSource, destLang:textDest}}, {upsert:true}, function (err, doc) {
                  if (!err){
                    if (tAuthor.hasRole(roleIDOtherLang)) {
                      bot.sendMessage(tAuthor, "[Language pairing saved: "+langCode(textSource, 3)+"-"+langCode(textDest, 3)+". Language codes no longer necessary until a new pairing is desired. | Example: !!good morning or !!!good morning]\n");
                    }
                  } else {
                    if (tAuthor.hasRole(roleIDOtherLang)) {
                      bot.sendMessage(tAuthor, "[Note: Failed to save language codes]");
                    }
                  }
                });
              }

              if ((textDest === "zh-CHS") || (textDest === "zh-CHT")){
                tbText = Translate.translate(tbText, false);
                tbText = Translate.parseTranslate(tbText);
                tbText = Translate.gEnCn(tbText);
              }
              if ((textDest === "en")){
                tbText = Translate.gCnEn(tbText);
              }

              OpenCC.traditionalToSimplified(tbText).then(function(tResult){

                if ((textSource===textDest) || ((textSource === "zh-CHT") && (textDest === "zh-CHS"))) {
                    var isPrivate = message.channel.isPrivate;
                    var copyMessage = message;
                    if (!message.channel.isPrivate) {bot.deleteMessage(message);}

                    if (!(tResult.match(/^[\s.。，；;,?？!！]*$/gi))){
                      if (isPrivate || sendDirect){
                        if (tAuthor.hasRole(roleIDOtherLang)) {
                          bot.sendMessage(tAuthor, "ct-cs/cn"+": "+tResult);
                        }

                      } else {
                        bot.sendMessage(copyMessage, tAuthor.name+": "+tResult);
                      }
                    }
                } else if ((textSource === "zh-CHS") && (textDest === "zh-CHT")) {
                  OpenCC.simplifiedToTraditional(tResult).then(function(TTResult){
                      var isPrivate = message.channel.isPrivate;
                      var copyMessage = message;
                      if (!message.channel.isPrivate) {bot.deleteMessage(message);}
                      if (!(TTResult.match(/^[\s.。，；;,?？!！]*$/gi))){
                        if (isPrivate || sendDirect){
                          if (tAuthor.hasRole(roleIDOtherLang)) {
                            bot.sendMessage(tAuthor, "cn/cs-ct"+": "+TTResult);
                          }
                        } else {
                          bot.sendMessage(copyMessage, tAuthor.name+": "+TTResult);
                        }
                      }
                  }).catch(function(err){bot.sendMessage(message, "-=-=-");});
                } else {
                  var translateInstance = new MsTranslator({client_id: users[0]["clientID"], client_secret: users[0]["clientSecret"]}, true);
                  var translateParams = {texts: [tResult], from: textSource, to: textDest, options:"{\"ProfanityAction\":\"Deleted\"}"};
                  var isPrivate = message.channel.isPrivate;
                  var copyMessage = message;
                  translateInstance.translateArray(translateParams, function(err, translatedData) {
                    if (!message.channel.isPrivate) {bot.deleteMessage(message);}
                    if (err){
                      if (err.toString().match(/ArgumentException/gi)){
                        responseHandler(tAuthor, "[失败: 帐号名或密码无效 (或已超月字限)]", "[Error: clientID or clientSecret INVALID (or exceeded monthly translation quota)]")
                      }else if (err.toString().match(/ArgumentOutOfRangeException/gi)){
                        responseHandler(tAuthor, "[失败: 翻译超越参数范围]", "[Error: Arguement out of range]")
                      }else if (err.toString().match(/TranslateApiException/gi)){
                        responseHandler(tAuthor, "[失败: 翻译模块出错]", "[Error: Translation api exception]")
                      }else if (err.toString().match(/ArgumentNullException/gi)){
                        responseHandler(tAuthor, "[失败: 无字条]", "[Error: Argument null]")
                      }
                    }
                    else {
                      var translatedResult = translatedData[0].TranslatedText;
                      if (!(translatedResult.match(/^[\s.。，；;,?？!！]*$/gi))){
                        if (isPrivate || sendDirect){
                          responseHandler(tAuthor, langCode(textSource, 1)+"-"+langCode(textDest, 1)+": "+translatedResult, langCode(textSource, 3)+"-"+langCode(textDest, 3)+": "+translatedResult);
                        }
                        else {
                          bot.sendMessage(copyMessage, tAuthor.name+": "+translatedResult);
                        }
                      }
                    }
                  });//.catch(function(err){console.log("caught the error here")});
                }
            });//.catch(function(err){bot.sendMessage(message, "--=-=--");});
          }
        }
      });

    } else if ((tbText.match(/^翻译安装/gi) || tbText.match(/^翻譯安裝/gi) || tbText.match(/^setTranslate/gi))){
      clearStorage();

      var tAuthor = message.author;
      var tAuthorID = message.author.id;

      tbText = tbText.replace(/^翻译安装/gi, "");
      tbText = tbText.replace(/^翻譯安裝/gi, "");
      tbText = tbText.replace(/^setTranslate/gi, "");

      var setupArray = tbText.split(/[,，]/);
      if (setupArray.length < 2){
          if (!message.channel.isPrivate) {bot.deleteMessage(message);}
          if (tAuthor.hasRole(roleIDOtherLang)) {
            bot.sendMessage(tAuthor, "Error：Missing Parameters | Use comma to separate clientID and clientSecret");
          }
      } else {
        var storeID = setupArray[0].replace(/^\s*/gi,"").replace(/\s*$/gi,"");
        var storeSecret = setupArray[1].replace(/^\s*/gi,"").replace(/\s*$/gi,"");
        UserDB.discordUsers.update({userID:tAuthorID},{ $set:{clientID:storeID, clientSecret:storeSecret}},{upsert:true}, function(err,doc){
            if (!message.channel.isPrivate) {bot.deleteMessage(message);}
            if (tAuthor.hasRole(roleIDOtherLang)) {
              bot.sendMessage(tAuthor, "[Setup Complete: clientID: "+storeID + " | clientSecret: "+storeSecret+"]");
            }
        });
      }
    }

  }
});

bot.on("presence", function(userPast,userPresent) {

	//console.log(userPast.status+" | "+userPresent.status+'\n\n\n\n\n');
  if ((userPast.status === 'offline') && (userPresent.status === 'online')) {
    if (userPresent.hasRole(roleIDOtherLang)){
          bot.sendMessage(userPresent, GreetingsFrgn).then(function(stuff){
            //displayTrackedItems(userPresent);
          }).then(function(stuff){scrapeDailyInfo(userPresent, '他文', "", "");});
    }
  }
});

//needs to be global, the server sometimes deletes duplicate data points that it receives,
//resulting in a later ad that has a higher index number but is nevertheless the same as a previous ad that's been deleted
//work-around: increase update interval to allow the server to delete these duplicates prior to bot making request
var adCurrentIndex = "";
var MentionList = {"Chinese":[], "Foreign":[]};

new CronJob('*/6 * * * * *', function() {
  updateAdChannels();
}, null, true, 'Asia/Shanghai');



function updateAdChannels(){
  RequestPromise("http://kamadan.decltype.org/api/latest").then(function(body){

    //get the latest result page
    var latestResults = JSON.parse(body).results;
    if (!latestResults){ return 4; }

    //uses entry id to keep track of new entries, timestamps are ignored
    //search and notify works only after the first message have been posted
    if (adCurrentIndex === ""){adCurrentIndex = parseInt(latestResults[0].id);}



    UserDB.adTable.find(function(err, items){
      if (err){
        console.log("error obtaining adTable data");

      } else{
        //console.log("updating ad channel")
        var displayAdResult = "";
        var displayAdResultFrgn = "";

        latestResults = latestResults.reverse();

        for (var i = 0; i < latestResults.length; i++) {

            var testIndex = parseInt(latestResults[i].id);

            if (testIndex > adCurrentIndex) {
              MentionList = {"Chinese":[], "Foreign":[]};
              adCurrentIndex = testIndex;
              for (j=0;j<items.length;j++){
                var searchString = items[j]["itemName"];
                var notifyList = items[j]["interestedParty"];
                if (searchString && notifyList){
                      var re = new RegExp(searchString, "gi");
                      if (latestResults[i].message.match(re) || Translate.parseTranslate(latestResults[i].message).match(re)){
                          for (var k = 0; k < notifyList.length; k++) {
                              var targetUser = bot.users.get("id",notifyList[k]);
                              if (targetUser.hasRole(roleIDOtherLang)){
                                MentionList["Foreign"].push(targetUser.mention());
                                //bot.sendMessage(targetUser, targetUser.mention()+":\n__**"+aResult.name+"**__: "+aResult.message+"\n\n");
                              }
                          }
                      }
                }
                /*
                console.log("searchstring and notify")
                console.log(searchString)
                console.log(notifyList)
                console.log("Search string is now: " + searchString + ", the list of interested party is: "+notifyList);
                */
                if ((notifyList == []) || (!notifyList) || (notifyList == "")) {UserDB.adTable.remove({ itemName: searchString});}
              }
              MentionList["Chinese"] = _.uniqWith(MentionList["Chinese"], _.isEqual);
              MentionList["Foreign"] = _.uniqWith(MentionList["Foreign"], _.isEqual);
              displayAdResult = displayAdResult + "" + "__**"+latestResults[i].name+"**__: "+Translate.parseTranslate(latestResults[i].message)+"\n\n";
              displayAdResultFrgn = displayAdResultFrgn + "" + "__**"+latestResults[i].name+"**__: "+latestResults[i].message+"\n\n";

            }
          }

          if (displayAdResultFrgn !== ""){
              bot.sendMessage(kamadanTextChannelFrgn, displayAdResultFrgn).then(function(stuff){
                trimOldAds(kamadanTextChannelFrgn);
              }).catch(function(error){
                bot.sendMessage(kamadanTextChannelFrgn,"```Posting Error```");
              });
          }
      }

    });

  }).catch(function(err){

    bot.sendMessage(kamadanTextChannelFrgn,"```Site Unreachable```");
  });
}

function trimOldAds(messageChannel){
  var bookmarkingMsg = "";
  var blocksize = 50;
  bot.getChannelLogs(messageChannel, blocksize).then(function(data){bookmarkingMsg = data[blocksize - 1];
    if (bookmarkingMsg){
    bot.getChannelLogs(messageChannel, blocksize, {before:bookmarkingMsg}).then(function(data){bookmarkingMsg = data[blocksize - 1];
      if (bookmarkingMsg){
      bot.getChannelLogs(messageChannel, blocksize, {before:bookmarkingMsg}).then(function(data){bookmarkingMsg = data[blocksize - 1];
        if (bookmarkingMsg){
        bot.getChannelLogs(messageChannel, blocksize, {before:bookmarkingMsg}).then(function(data){bookmarkingMsg = data[blocksize - 1];
          if (bookmarkingMsg){
          bot.getChannelLogs(messageChannel, blocksize, {before:bookmarkingMsg}).then(function(data){bookmarkingMsg = data[blocksize - 1];
            if (bookmarkingMsg){
            bot.getChannelLogs(messageChannel, blocksize, {before:bookmarkingMsg}).then(function(data){
              bot.deleteMessages(data);
            });
            }
          });
          }
        });
        }
      });
      }
    });
    }
  });
}

function clearStorage(){
  outputText = "";
  outputText1 = "";
  outputText2 = "";
  outputText3 = "";
  tempOutput = "";
  arrayLength = 0;
  styledOutput = "";

  var outputTextFrgn = "";
  var outputText1Frgn = "";
  var outputText2Frgn = "";
  var outputText3Frgn = "";
  var styledOutputFrgn = "";
  var savedOutputFrgn = "";
}

function scrapeDailyInfo(message, lang, prefix, suffix){

  clearStorage();


  var tNow = new Date();
  var tYesterday = new Date(tNow.getTime());
  tYesterday.setDate(tYesterday.getDate() - 1);

  var tYearNow = tNow.getUTCFullYear();
  var tMonthNow = tNow.getUTCMonth()+1;
  var tDateNow = tNow.getUTCDate();

  var tYearYesterday = tYesterday.getUTCFullYear();
  var tMonthYesterday = tYesterday.getUTCMonth()+1;
  var tDateYesterday = tYesterday.getUTCDate();

    //加文字日期
  var tTodayText = tDateNow + ' ' + monthConversion(tMonthNow) + ' ' + tYearNow;
  var tYesterdayText = tDateYesterday + ' ' + monthConversion(tMonthYesterday) + ' ' + tYearYesterday;

  if (tMonthNow < 10) {
      tMonthNow = '0'+tMonthNow;
  }
  if (tDateNow < 10) {
      tDateNow = '0'+tDateNow;
  }

  var tString1 = tYearNow+'-'+tMonthNow+'-'+tDateNow+'T16:00:00';
  var tString2 = tYearNow+'-'+tMonthNow+'-'+tDateNow+'T07:00:00';

  var tTodayCutoff16 = new Date(tString1);
  var tTodayCutoff07Sandford = new Date(tString2);

  //begin traveler section
  var tDay = tNow.getUTCDay(); //day of the week
  var t_ThisMondayDate = tNow.getUTCDate() - tDay + (tDay == 0 ? -6:1)

  var tThisMondayCutoff = new Date(Date.UTC(tYearNow, tMonthNow-1, t_ThisMondayDate, 15, 0, 0));
  var tLastMondayCutoff = new Date(Date.UTC(tYearNow, tMonthNow-1, t_ThisMondayDate-7, 15, 0, 0));
  //加文字日期
  var tThisMondayText = tThisMondayCutoff.getUTCDate() + ' ' + monthConversion(tThisMondayCutoff.getUTCMonth()+1) + ' ' + tThisMondayCutoff.getUTCFullYear();
  var tLastMondayText = tLastMondayCutoff.getUTCDate() + ' ' + monthConversion(tLastMondayCutoff.getUTCMonth()+1) + ' ' + tLastMondayCutoff.getUTCFullYear();
  //end traveler section

  var zaishenDate = (tNow >= tTodayCutoff16) ? tTodayText : tYesterdayText;
  var sandfordDate = (tNow >= tTodayCutoff07Sandford) ? tTodayText : tYesterdayText;
  //console.log(tThisMondayText);
  //console.log(tLastMondayText);
  var travelerDate = (tNow >= tThisMondayCutoff) ? tThisMondayText : tLastMondayText;
  //console.log(travelerDate);

  if ((zaishenFlag === zaishenDate) && (sandfordFlag === sandfordDate) && (travelerFlag===travelerDate) && (savedOutput !== "") && (savedOutputFrgn !== "")){
      //asynced check: "今日资料: \n"+
      if (lang==='中文'){
        if (message.author){
          //is pm channel and receipient is bot, then don't type it
          if (message.channel.isPrivate){
          } else {
            bot.sendMessage(message, "详见私聊");
          }
          bot.sendMessage(message.author, prefix + addFestivalData(savedOutput, lang) + suffix);
        } else {
          bot.sendMessage(message, prefix + addFestivalData(savedOutput, lang) + suffix);
        }

      }else if (lang==='他文'){
         if (message.author){
           //is pm channel and receipient is bot, then don't type it
           if (message.channel.isPrivate){
           } else {
             bot.sendMessage(message, "详见私聊 (See Private Message)");
           }
           bot.sendMessage(message.author, prefix + addFestivalData(savedOutputFrgn, lang) + suffix);
         } else {
           bot.sendMessage(message, prefix + addFestivalData(savedOutputFrgn, lang) + suffix);
         }

      }

  }
  else{
    RetrieveData(message, zaishenDate, sandfordDate, travelerDate, lang, prefix, suffix);
  }

}


function RetrieveData(message, zaishenDate, sandfordDate, travelerDate, lang, prefix, suffix){

        var waiting = 3;

        outputText = '**主页:** http://jizhan1.coding.me' + '\n' + '**广告:** http://jizhan1.coding.me/广告' + '\n' +'**其他:** http://jizhan1.coding.me/补编' + '\n\n';
        var generateNow = new Date();
        var urlSuffix = "%3F"+generateNow.getTime();
        Request("https://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20html%20where%20url%3D'http%3A%2F%2Fwiki.guildwars.com%2Fwiki%2FNicholas_the_Traveler%2FCycle"+urlSuffix+"'&format=xml&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys", function (error, response, body) {
          if (!error) {
            var $ = Cheerio.load(body);
            //var todaysData = $( "tr[style*='font-weight: bold']" ).text();
            var currentElement = $( "tr:contains('"+travelerDate+"')" );
            var todaysData = currentElement.text();
            var numberNeeded = todaysData.split('\n')[1].charAt(1);
            var todaysItem = Translate.translate(todaysData.split('\n')[1]);
            var currentUTCDay = todaysData.split('\n')[0];

            var nextWeekData = currentElement.next().text();
            var nextNumberNeeded = nextWeekData.split('\n')[1].charAt(1);
            var nextWeekItem = Translate.translate(nextWeekData.split('\n')[1]);

            outputText1 = '**旅行者:** (http://jizhan1.coding.me/旅者)' + '\n\n' + '* ' + numberNeeded + " "+ todaysItem + ':'  +'\n' +
            '[' + TravelerData.detailData[todaysItem] + ']' + '\n\n' + '下周预告:\n' + nextNumberNeeded + " "+ nextWeekItem + ':'  +'\n' +
            TravelerData.detailData[nextWeekItem] + '\n\n';
            outputText1Frgn = '**Nicholas the Traveler:** (http://wiki.guildwars.com/wiki/Nicholas_the_Traveler/Cycle)' + '\n\n' +
            '* ' + todaysData.split('\n')[1]  + '\n\n' + 'Next week:\n' + nextWeekData.split('\n')[1].replace(/^\s*?/gi, "") + '\n\n';
            //+ ' (' + "http://jizhan1.coding.me/旅者" + ')'
          }  else {
            outputText1='激战网出错，旅者资料缺失\n\n';
            outputText1Frgn = 'Error: Unable to reach wiki\n\n';
          }
          if(--waiting == 0) scrapeResult(message, zaishenDate, sandfordDate, travelerDate, lang, prefix, suffix);
        });

        Request("https://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20html%20where%20url%3D'http%3A%2F%2Fwiki.guildwars.com%2Fwiki%2FWeekly_bonuses"+urlSuffix+"'&format=xml&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys", function (error, response, body) {
          if (!error) {
            var $ = Cheerio.load(body);
            var todaysData1 = $("b").eq(0).text();
            var todaysData2 = $("b").eq(1).text();

            todaysData1 = todaysData1.replace(/^\s*?/gi, "")
            todaysData1 = todaysData1.replace(/\s*?$/gi, "")
            todaysData2 = todaysData2.replace(/^\s*?/gi, "")
            todaysData2 = todaysData2.replace(/\s*?$/gi, "")

            var tIndex1 = _.findIndex(weeklyBonus1, function(stuff) { return stuff === todaysData1; });
            var tIndex2 = _.findIndex(weeklyBonus2, function(stuff) { return stuff === todaysData2; });
            var nexData1 = "数据出错";
            var nexData2 = "数据出错";


            if ((tIndex1 !== -1) && (tIndex2 !== -1)){
                nexData1 = weeklyBonus1[(tIndex1 === (weeklyBonus1.length - 1)) ? 0 : (tIndex1 + 1)];
                nexData2 = weeklyBonus2[(tIndex2 === (weeklyBonus2.length - 1)) ? 0 : (tIndex2 + 1)];
            }


            var tThisMoment = new Date();
            var tCurrentYear = tThisMoment.getUTCFullYear();

            var startDate = new Date(tCurrentYear+'-08-25T19:00:00');
            var endDate = new Date(tCurrentYear+'-09-01T19:00:00');
            //possibly work in the 1 min of 19:01 boundary
            var WayfarerArray = ["Elonian Support Bonus", "Extra Luck Bonus", "Faction Support Bonus", "Northern Support Bonus"];
            var WayfarerResults = _.difference(WayfarerArray, [todaysData1, todaysData2]);
            var Wayfarer = "";
            var WayfarerFrgn = "";

            if ((tThisMoment >= startDate) && (tThisMoment <= endDate)) {
              //Wayfarer's cannot possibly be of 0 length, so did not check for this condition
              Wayfarer = "* ";
              WayfarerFrgn = "* ";
              for (i = 0; i < WayfarerResults.length; i++) {
                  Wayfarer = Wayfarer + Translate.translate(WayfarerResults[i]) + ((i===(WayfarerResults.length-1))?"\n\n":"\n\n* ");
                  WayfarerFrgn = WayfarerFrgn + WayfarerResults[i] + ((i===(WayfarerResults.length-1))?"\n\n":"\n\n* ");
              }
            }

            var timeToWayfarer = startDate - tThisMoment;
            var nextWayfarerResults = _.difference(WayfarerArray, [nexData1, nexData2]);
            var nextWayfarer = "";
            var nextWayfarerFrgn = "";
            if ((timeToWayfarer > 0) && (timeToWayfarer <= (7*24*60*60*1000))){
              for (i = 0; i < nextWayfarerResults.length; i++) {
                  nextWayfarer = nextWayfarer + Translate.translate(nextWayfarerResults[i]) + "\n";
                  nextWayfarerFrgn = nextWayfarerFrgn + nextWayfarerResults[i] + "\n";
              }
            }

            outputText2 = '**本周奖励:** (http://jizhan1.coding.me/奖励)\n\n* ' + Translate.translate(todaysData1) + '\n\n* ' + Translate.translate(todaysData2) + '\n\n' +
            Wayfarer + "下周预告: \n" + Translate.translate(nexData1) + '\n' + Translate.translate(nexData2) + '\n' + nextWayfarer + '\n';

            outputText2Frgn = '**Weekly Bonuses:** (http://wiki.guildwars.com/wiki/Weekly_bonuses)\n\n* ' + todaysData1 + '\n\n* ' + todaysData2 +'\n\n' +
            WayfarerFrgn + "Next week: \n" + nexData1 + '\n' + nexData2 + '\n' + nextWayfarerFrgn + '\n';

          }else {
            outputText2='激战网出错，奖励资料缺失\n\n';
            outputText2Frgn = 'Error: Unable to reach wiki\n\n';
          }
          if(--waiting == 0) scrapeResult(message, zaishenDate, sandfordDate, travelerDate, lang, prefix, suffix);
        });

        Request("https://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20html%20where%20url%3D'http%3A%2F%2Fwiki.guildwars.com%2Fwiki%2FDaily_activities"+urlSuffix+"'&format=xml&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys", function (error, response, body) {
          if (!error) {
            var $ = Cheerio.load(body);
            var zaishenElement = $("tr:contains('"+zaishenDate+"')");
            var tomorrowsData = zaishenElement.next().text().split('\n');

            var forecast = "";
            var forecastFrgn = "";

            for (i = 1; i < 7; i++) {
                forecast = forecast + Translate.translate(tomorrowsData[i]) + " | ";
                forecastFrgn = forecastFrgn + tomorrowsData[i] + " | ";
            }

            var todaysData = zaishenElement.text();
            var todaysData1 = todaysData.split('\n')[1];
            var todaysData2 = todaysData.split('\n')[2];
            var todaysData3 = todaysData.split('\n')[3];
            var todaysData4 = todaysData.split('\n')[4];
            var todaysData5 = todaysData.split('\n')[5];
            var todaysData6 = todaysData.split('\n')[6];
            var sandfordElement = $("tr:contains('"+sandfordDate+"')");
            todaysData = sandfordElement.text();
            var todaysData7 = todaysData.split('\n')[7];

            forecast = forecast + Translate.translate(sandfordElement.next().text().split('\n')[7]);
            forecastFrgn = forecastFrgn + sandfordElement.next().text().split('\n')[7];



            outputText3 = '**战承及其他活动:** (http://jizhan1.coding.me/战承)\n\n' + 	'* 主线任务: __' + Translate.translate(todaysData1) + '__\n' +
            '* 悬赏任务: __' + Translate.translate(todaysData2) +'__\n' +
            '* 对战任务: __' + Translate.translate(todaysData3) +'__\n' +
            '* 清图任务: __' + Translate.translate(todaysData4) +'__\n' +
            '* 光刃通缉令: __' + Translate.translate(todaysData5) +'__\n' +
            '* 黑檀先锋队任务: __' + Translate.translate(todaysData6) +'__\n' +
            '* 毁灭前旅行者: __' + Translate.translate(todaysData7) +'__\n\n' + "明日预告:\n" + forecast.replace(/^\s*?/gi,"") + "\n\n";

            outputText3Frgn = '**Daily Activities:** (http://wiki.guildwars.com/wiki/Daily_activities)\n\n' + 	'* Zaishen Mission: __' + todaysData1 + '__\n' +
            '* Zaishen Bounty: __' + todaysData2 +'__\n' +
            '* Zaishen Combat: __' + todaysData3 +'__\n' +
            '* Zaishen Vanquish: __' + todaysData4 +'__\n' +
            '* Shining Blade: __' + todaysData5 +'__\n' +
            '* Vanguard Quest: __' + todaysData6 +'__\n' +
            '* Nicholas Sandford (Pre): __' + todaysData7 +'__\n\n' + "Tomorrow's Activities:\n" + forecastFrgn.replace(/^\s*?/gi,"") + "\n\n";
          }else {
              outputText3='激战网出错，战承资料缺失\n\n';
              outputText3Frgn = 'Error: Unable to reach wiki\n\n';
          }
          if(--waiting == 0) scrapeResult(message, zaishenDate, sandfordDate, travelerDate, lang, prefix, suffix);
        });
}

function scrapeResult(message, zaishenDate, sandfordDate, travelerDate, lang, prefix, suffix){
//  if (savedOutput!==""){
    styledOutput = outputText + outputText1 + outputText2 + outputText3;
    styledOutputFrgn = outputText1Frgn + outputText2Frgn + outputText3Frgn;

    savedOutput = styledOutput;
    savedOutputFrgn = styledOutputFrgn;

    zaishenFlag = zaishenDate;
    sandfordFlag = sandfordDate;
    travelerFlag = travelerDate;

    if (lang === '中文'){
      if (!message.author){
        var lengthCheck = prefix + addFestivalData(styledOutput, '中文') + suffix;

        if (lengthCheck.length > 2000){
            bot.sendMessage(message, "[内容已超字数限制]\n\n(==可用 '!说明' 及 '!激战' 指令 获取相关资料==)");
        } else {
            bot.sendMessage(message, lengthCheck);
        }
      } else {
        //is pm channel and receipient is bot, then don't type it
        if (message.channel.isPrivate){
        } else {
          bot.sendMessage(message, "详见私聊");
        }
        bot.sendMessage(message.author, prefix + addFestivalData(styledOutput, '中文') + suffix);
      }
    } else if (lang === '他文'){
      if (!message.author){
        var lengthCheck = prefix + addFestivalData(styledOutputFrgn, '他文') + suffix;
        if (lengthCheck.length > 2000){
          bot.sendMessage(message, "[Automated Response Exceeded Length Limit]\n\n(==Please use '!help' and '!guildwars' to access content==)");
        } else {
          bot.sendMessage(message, lengthCheck);
        }
      } else {
        //is pm channel and receipient is bot, then don't type it
        if (message.channel.isPrivate){
        } else {
          bot.sendMessage(message, "详见私聊 (See Private Message)");
        }
        bot.sendMessage(message.author, prefix + addFestivalData(styledOutputFrgn, '他文') + suffix);
      }

    }

//  }else {

//  }
}

function addFestivalData(originalOutput, lang){

  if (lang === '中文'){
      originalOutput = "\n```今日活动:```\n" + originalOutput + '**节日:**\n\n';
  } else if (lang === '他文'){
      originalOutput = "\n```Today's activities:```\n" + originalOutput + '**Festivals:**\n\n';
  }

  var matched = -1;

  var tThisMoment = new Date();
  var tCurrentYear = tThisMoment.getUTCFullYear();

  var tDateR = new Date(tCurrentYear+Festivals.festivalData[0][1]);
  var tDateL = new Date(tCurrentYear+Festivals.festivalData[0][0]);

  if ((tThisMoment >= tDateL) || (tThisMoment <= tDateR)){
    //((a < b) ? 2 : 3)
    if (lang === '中文'){
        originalOutput = originalOutput + '__' + Festivals.festivalData[0][2] + '__' + ((Festivals.festivalData[0][3] ==='') ? '' : ('\n' + Festivals.festivalData[0][3])) + '\n\n';
    } else if (lang === '他文'){
        originalOutput = originalOutput + '__' + Festivals.festivalData[0][4] + '__' + ((Festivals.festivalData[0][5] ==='') ? '' : ('\n' + Festivals.festivalData[0][5])) + '\n\n';
    }

    matched = 0;
  }

  for (var i = 1; i<13; i++){
      var startDate = new Date(tCurrentYear+Festivals.festivalData[i][0]);
      var endDate = new Date(tCurrentYear+Festivals.festivalData[i][1]);
      //possibly work in the 1 min of 19:01 boundary
      if ((tThisMoment >= startDate) && (tThisMoment <= endDate)){
          if (lang === '中文'){
              originalOutput = originalOutput + '__' + Festivals.festivalData[i][2] + '__' + ((Festivals.festivalData[i][3] ==='') ? '' : ('\n' + Festivals.festivalData[i][3])) + '\n\n';
          } else if (lang === '他文'){
              originalOutput = originalOutput + '__' + Festivals.festivalData[i][4] + '__' + ((Festivals.festivalData[i][5] ==='') ? '' : ('\n' + Festivals.festivalData[i][5])) + '\n\n';
          }

          matched = i;
      }

  }

  var nextFestivalIndex = 0;

  if (matched > -1 ) {
    (matched === 12)?(nextFestivalIndex=0):(nextFestivalIndex=matched+1);

    var sMonth = parseInt(Festivals.festivalData[nextFestivalIndex][0].slice(1,3));
    var sDate = parseInt(Festivals.festivalData[nextFestivalIndex][0].slice(4,6));
    var eMonth = parseInt(Festivals.festivalData[nextFestivalIndex][1].slice(1,3));
    var eDate = parseInt(Festivals.festivalData[nextFestivalIndex][1].slice(4,6));
    if (lang === '中文'){
        originalOutput = originalOutput + "节日预告:\n"  + Festivals.festivalData[nextFestivalIndex][2] + " (" + sMonth + "月" + (sDate+1) + "日" + " 至 " +
        eMonth + "月" + (eDate+1) + "日)" +
        ((Festivals.festivalData[nextFestivalIndex][3] ==='') ? '' : ('\n' + Festivals.festivalData[nextFestivalIndex][3])) + '\n\n';
    } else if (lang === '他文'){
        originalOutput = originalOutput + "Next Event:\n"  + Festivals.festivalData[nextFestivalIndex][4] + " (" + monthConversion(sMonth) + " " + sDate + " To " +
        monthConversion(eMonth) + " " + eDate + ")" +
        ((Festivals.festivalData[nextFestivalIndex][5] ==='') ? '' : ('\n' + Festivals.festivalData[nextFestivalIndex][5])) + '\n\n';
    }
    return originalOutput;
  } else {
    originalOutput = originalOutput + ((lang === '中文') ? "[无节日]\n\n" : "[No ongoing festival]\n\n");

    var timeDiffArray = []
    for (var i=0;i<13;i++){
      var tStartDate = new Date(tCurrentYear+Festivals.festivalData[i][0]);
      if ((tStartDate - tThisMoment) < 0) {
        timeDiffArray.push(50000000);
      } else {
          timeDiffArray.push((tStartDate - tThisMoment)/1000);
      }
    }

    var resultIndex = 0;
    var minValue = timeDiffArray[0];
    for (var i = 1; i < timeDiffArray.length; i++) {
      if (timeDiffArray[i] < minValue) {
        minValue = timeDiffArray[i];
        resultIndex = i;
      }
    }

    var sMonth = parseInt(Festivals.festivalData[resultIndex][0].slice(1,3));
    var sDate = parseInt(Festivals.festivalData[resultIndex][0].slice(4,6));
    var eMonth = parseInt(Festivals.festivalData[resultIndex][1].slice(1,3));
    var eDate = parseInt(Festivals.festivalData[resultIndex][1].slice(4,6));
    if (lang === '中文'){
        originalOutput = originalOutput + "节日预告:\n"  + Festivals.festivalData[resultIndex][2] + " (" + sMonth + "月" + (sDate+1) + "日" + " 至 " +
        eMonth + "月" + (eDate+1) + "日)" +
        ((Festivals.festivalData[resultIndex][3] ==='') ? '' : ('\n' + Festivals.festivalData[resultIndex][3])) + '\n\n';
    } else if (lang === '他文'){
        originalOutput = originalOutput + "Next Event:\n"  + Festivals.festivalData[resultIndex][4] + " (" + monthConversion(sMonth) + " " + sDate + " To " +
        monthConversion(eMonth) + " " + eDate + ")" +
        ((Festivals.festivalData[resultIndex][5] ==='') ? '' : ('\n' + Festivals.festivalData[resultIndex][5])) + '\n\n';
    }

    return originalOutput;
  }
}

function monthConversion(data){

	switch(data){
		case 1:
			data = "January";
			break;
		case 2:
			data = "February";
			break;
		case 3:
			data = "March";
			break;
		case 4:
			data = "April";
			break;
		case 5:
			data = "May";
			break;
		case 6:
			data = "June";
			break;
		case 7:
			data = "July";
			break;
		case 8:
			data = "August";
			break;
		case 9:
			data = "September";
			break;
		case 10:
			data = "October";
			break;
		case 11:
			data = "November";
			break;
		case 12:
			data = "December";
			break;
		default:
			break;
	}

	return data;
}

function langCode(tInput, tSelector){
  var lookupArray = [["zh-CHS","中","中","cn"],
                     ["fr","法","法","fr"],
                     ["ru","俄","俄","ru"],
                     ["de","德","德","de"],
                     ["en","英","英","en"],
                     ["es","西","西","es"],
                     ["pt","葡","葡","pt"],
                     ["zh-CHS","简","簡","cs"],
                     ["zh-CHT","繁","繁","ct"]];
 if ((tInput !== "zh-CHS") && (tInput !== "zh-CHT")){
   tInput = tInput.toLowerCase();
 }
 var returnValue = "error";
 for (i=0;i<lookupArray.length;i++){
   if (_.includes(lookupArray[i], tInput)){
     returnValue = lookupArray[i][tSelector];
     break;
   }
 }
 return returnValue;
}


function responseHandler(resolvable, messageChinese, messageForeign){
  if (resolvable.hasRole(roleIDOtherLang)){
    bot.sendMessage(resolvable, messageForeign);
  } else {
    bot.sendMessage(resolvable, messageForeign);
  }
}

function TemplateSender(message, selectArea){

  var tAuthor = message.author;
  var tTargetUser = message.mentions[0];
  var sendThis = "[空]";
  var sendThisFrgn = "[空]";

  switch(selectArea) {
    case '地下':
        sendThis = UWtemplateAndLinks
        sendThisFrgn = UWtemplateAndLinksFrgn
        break;
    case '四门':
        sendThis = DOAtemplateAndLinks
        sendThisFrgn = DOAtemplateAndLinksFrgn
        break;
    case '灾难':
        sendThis = FOWtemplateAndLinks
        sendThisFrgn = FOWtemplateAndLinksFrgn
        break;
    case '其他':
        sendThis = OTHERtemplateAndLinks
        sendThisFrgn = OTHERtemplateAndLinksFrgn
        break;
  }

  if (!message.channel.isPrivate) {bot.deleteMessage(message);}

  if (tTargetUser){
    if (tTargetUser.hasRole(roleIDOtherLang)) {
      bot.sendMessage(tTargetUser, sendThisFrgn).then(function (stuff){
        if (sendThisFrgn === DOAtemplateAndLinksFrgn) {bot.sendMessage(tTargetUser, DOAtemplateAndLinksFrgn2).then(function (temp){
          bot.sendMessage(tTargetUser, DOAtemplateAndLinksFrgn3);
        });}
        if (sendThisFrgn === FOWtemplateAndLinksFrgn) {bot.sendMessage(tTargetUser, FOWtemplateAndLinksFrgn2)}
      });
    }
  } else {
    if (tAuthor.hasRole(roleIDOtherLang)) {
      bot.sendMessage(tAuthor, sendThisFrgn).then(function (stuff){
        if (sendThisFrgn === DOAtemplateAndLinksFrgn) {bot.sendMessage(tAuthor, DOAtemplateAndLinksFrgn2).then(function (temp){
          bot.sendMessage(tAuthor, DOAtemplateAndLinksFrgn3);
        });}
        if (sendThisFrgn === FOWtemplateAndLinksFrgn) {bot.sendMessage(tAuthor, FOWtemplateAndLinksFrgn2)}
      });
    }
  }

}

var UWtemplateAndLinks = "```js\n[复制链接 并 向频道发送后 即可观看]\n\n\
'1. 荒凉冰地': OgcTc5+8ZSn5A6uU4QOL0BBC3BA | 'https://www.youtube.com/watch?v=1JXeO_P7eLA'\n\
'2. 龙山+孵化池': OgcTcZ88ZSn5A6uU4wt85IgB3BA | 'https://www.youtube.com/watch?v=ILkrppIn6I0'\n\
'3. 浑浊平原': OgcTc5+8ZSn5A6uU4IXM0BBC3BA | 'https://www.youtube.com/watch?v=OaFt7q0gh7c'\n\
'4. 骷髅墓穴': OgVjIwJMzQaDfVbVGAyA3U8Q0l | 'https://www.youtube.com/watch?v=woLJyUEgjbE'\n\
'5. 祭祀': OAKjgpiK5SXTOOPH5iIHbHyl0lA | 'https://www.youtube.com/watch?v=rU2t5WkMlwg'\n\
'6. 打手':  OQJVAuAJ4xZRSG4myGUDwDqlB6guEA | 'https://www.youtube.com/watch?v=GiAUzMpHK8o'\n\
'7. 大队领队': OQdlAYBnQOMf8EB0ZHQEIu7tdTlB | 'https://www.youtube.com/watch?v=POjBee_01kU'\n\
'8. 元素僧': OgNDwcPPT3MaR1CkE0lxDyDHEA | 'https://www.youtube.com/watch?v=lQDYv_JCdyk'```\n\
```js\n慢速团: \n\n\
'神唤1': 'OgGjkurMrRsXfbmXaX0l0kNX7gA'\n\
'神唤2': 'Ogek8Jp7Kza03m5l2FuDNZzFuocJ'\n\
'僧': 'OwIT0QIjVC5IHcjAkQucVc7ghAA'```\n\
```js\n其他资料:\n\n\
'地下记录团': 'http://gwscr.com/forum/viewtopic.php?f=31&t=1877'\n\
'字母版地下介绍+截图': 'http://fbgmguild.com/showthread.php?tid=527'```\n\
```\n\
古兰斯的使者 (荒凉冰地任务) - 敌出现顺序:\n\n\
4 黄蜘蛛\n\
1 骷髅 (之一)\n\
2 白蜘蛛\n\
1 骷髅 (之二)\n\
1 黄蜘蛛\n\
1 骷髅 (之三) + 1 黄蜘蛛\n\n\
---------[骷髅部分完毕]----------\n\
4 黄蜘蛛\n\
2 白蜘蛛 (近祭坛者会奔往守护者，须予以拦截)\n\
2 黄蜘蛛 (近祭坛者会奔往守护者，须予以拦截)\n\
4 黄蜘蛛\n\
---------[ 怪已尽出 ]----------\n\n\
怪尽出后继续清骷髅及后山道\n\
注: 守护者无法抵挡他人的进攻，接触敌人即灭团\n\
注: 冰王+守卫可挡住(不多于)三只蜘蛛的进攻\n\
若无法拦截所有蜘蛛: 优先拦截奔往守护者之敌，任其他蜘蛛逃开```\n";

var UWtemplateAndLinksFrgn = "```js\n[Pasting links into chat will display video]\n\n\
'1. Ice Wastes': OgcTc5+8ZSn5A6uU4QOL0BBC3BA | 'https://www.youtube.com/watch?v=1JXeO_P7eLA'\n\
'2. Mountains+Pools': OgcTcZ88ZSn5A6uU4wt85IgB3BA | 'https://www.youtube.com/watch?v=ILkrppIn6I0'\n\
'3. Chaos Planes': OgcTc5+8ZSn5A6uU4IXM0BBC3BA | 'https://www.youtube.com/watch?v=OaFt7q0gh7c'\n\
'4. Bone Pits': OgVjIwJMzQaDfVbVGAyA3U8Q0l | 'https://www.youtube.com/watch?v=woLJyUEgjbE'\n\
'5. Ritualist': OAKjgpiK5SXTOOPH5iIHbHyl0lA | 'https://www.youtube.com/watch?v=rU2t5WkMlwg'\n\
'6. Spiker':  OQJVAuAJ4xZRSG4myGUDwDqlB6guEA | 'https://www.youtube.com/watch?v=GiAUzMpHK8o'\n\
'7. LT': OQdlAYBnQOMf8EB0ZHQEIu7tdTlB | 'https://www.youtube.com/watch?v=POjBee_01kU'\n\
'8. Emo': OgNDwcPPT3MaR1CkE0lxDyDHEA | 'https://www.youtube.com/watch?v=lQDYv_JCdyk'```\n\
```js\nCasual Run: \n\n\
'Vos 1': 'OgGjkurMrRsXfbmXaX0l0kNX7gA'\n\
'Vos 2': 'Ogek8Jp7Kza03m5l2FuDNZzFuocJ'\n\
'Monk': 'OwIT0QIjVC5IHcjAkQucVc7ghAA'```\n\
```js\nOther Info:\n\n\
'UW Record Run': 'http://gwscr.com/forum/viewtopic.php?f=31&t=1877'\n\
'Underworld Notes': 'http://fbgmguild.com/showthread.php?tid=527'```\n\
```\n\
Servants of Grenth (Ice Wastes quest) - Enemy Spawn Order:\n\n\
4 Yellow Dryders\n\
1 Skeleton (first)\n\
2 White Dryders\n\
1 Skeleton (second)\n\
1 Yellow Dryder\n\
1 Skeleton (third) + 1 Yellow Dryder\n\n\
---------[Followed By]----------\n\
4 Yellow Dryders\n\
2 White Dryders (the one closer to reaper will run to reaper if not intercepted)\n\
2 Yellow Dryders (the one closer to reaper will run to reaper if not intercepted)\n\
4 Yellow Dryders\n\
-----[ All enemies spawned ]----\n\n\
After all enemies are spawned, kill any remaining skeletons and clear the path to dhuum chamber\n\
Note: Leaking any dryders to Reaper will end in fail\n\
Note: Leaking ~3 dryders to King is Ok\n\
Consequently, focus on intercepting reaper-bound dryders and let others go to King if you must```\n";

var DOAtemplateAndLinks = "```js\n[复制链接 并 向频道发送后 即可观看]\n\n\
'1. 主暗杀': OwViMwfMpzcAhAFBYT25QTi7A           |  'https://www.youtube.com/watch?v=DPp4uJ8Ou-w'\n\
''                                              |   'https://www.youtube.com/watch?v=Ctojwl8sooI'\n\
'2. 副暗杀': OwFjUxf84QHQ6MhONQ0kdOIQ4O          |  'https://www.youtube.com/watch?v=T0B6KME0L8Q'\n\
'2. 副暗杀 游侠版'                               |  'https://www.youtube.com/watch?v=KaLbLNuw-do'\n\
'2. 副暗杀 托加城 内城 左则'                      |  'https://www.youtube.com/watch?v=n7Ys7b5VfOA'\n\
'2. 副暗杀 冥狱之幕  前六组怪'                    |   'https://www.youtube.com/watch?v=cLUZxg851sg'\n\
'2. 副暗杀 冥狱之幕 神唤地王 及 僧霸主'            |   'https://www.youtube.com/watch?v=lupWQPC-mEg'\n\
'2. 副暗杀 夺心暗域 洞口'                         |  'https://www.youtube.com/watch?v=EDH8rk-s7W8'\n\
'2. 副暗杀 铸造厂 第三条蛇 及 狂怒者'              |  'https://www.youtube.com/watch?v=3vLIkuvnd3A'\n\
'3. 领队/主幻术': OQJTAQBbVCu0tx0Z6JmUwZDA6AA    |  'https://www.youtube.com/watch?v=pyQQ7xWM924'\n\
'4. 触须及外围杀手': OQdDAYsySLBnAIgyl2kIQ0kdOA   |  'https://www.youtube.com/watch?v=5VpS1yXvYJc'\n\
''                                               |  'https://www.youtube.com/watch?v=KQyYmTo37So'\n\
'5. 僧主杀手': OQhjAwCsYQLBnAmO2g3UTPcAxkA       |  'https://www.youtube.com/watch?v=MaD2q-ADwXU'\n\
'6. 四号幻术':  OQRCAsw0SwJgpjN40jNpGwNI         |  'https://www.youtube.com/watch?v=_61cv2FhtX4'\n\
'7. 种子僧': OwUS8YITLB5g3VylAExDME0l            |  'https://www.youtube.com/watch?v=1gb5kPwj7j4'\n\
'8. 元素僧': OgNDwcPPP3MtIJ5gEPkHX/aB            |  'https://www.youtube.com/watch?v=24l8iByoE9c'\n\
''                                               |  'https://www.youtube.com/watch?v=yakx2aWNfcM'```\n\
```js\n其他资料:\n\n\
'路线动画':      'https://www.youtube.com/watch?v=QQ0DAOc2fT0'\n\
'字母版常用词':  'http://fbgmguild.com/showthread.php?tid=700'\n\
'字母版笔记旧':  'http://fbgmguild.com/showthread.php?tid=537'```\n\n";
//'字母版笔记':    'https://docs.google.com/document/d/1COKjs3TjZYg6WSvK0zzXybH5bCIZvOGS8JK0-md8f4w/edit?pref=2&pli=1'\n\
var DOAtemplateAndLinks2 = "```js\n四门常见提示:\n\n\
若不意引到敌人，或被敌缠身，勿后退或撤退，请就地死去\n\
各幻术应跟随领队幻术， 并在其发起进攻前回避敌人; 领队幻术正副职为: 幻术/游侠\n\
缺“保护连结”时: 走近元素僧 + 报告队伍中自己的位置(1-8)\n\
当被告知不要接任务时, 勿接任务或任务奖励\n\
打开光明头衔; 若头衔低于8, 向唤言情报员取狩猎赐福\n\
如夺心暗域过于黑暗, 可用设置调亮 (须全屏)\n\
请阅角色所带各技能，以扩大打击力\n\n\
夺心暗域 - 巨大阴影:\n\n\
发起进攻后不要移动, 能量短缺时再换高能量的副手/武器\n\
第一波怪: 用盾（以便隐藏能量），勿用“回音”，其他技能不限\n\
第二波怪: “回音”复制“疑惑”或“能量震荡”，并不断向敌人散播(更换目标)此二技能。\n\
         可用技能  (伤害均匀的): 能量震荡，恍惚之眼，痛苦哭喊，及疑惑。\n\
         不可﻿用技能(伤害不匀的):  反常纹章﻿，﻿懊悔幻想 或 瓦斯崔之死 (后二者有效范围过小无法同时打击众敌)\n\
第三波怪: 随意进攻，但如能量不足，避免在没有灭绝或敌人血量还高的时候使用单击技能'\n\n\
失败事物铸造厂 - 狂怒者:\n\n\
敌聚集后，幻术应 成半圆形四散于 其触发圈边缘\n\
预先使用“回音”，并锁定一名骑士 (可马力守护者)\n\
进攻时不断用“疑惑”打击各骑士 (如目标已被咒 则换下一目标)\n\
“疑惑”恢复时，给玛古奈 齐 上“魔力反噬”，或使用其他进攻技能\n\
“疑惑”恢复后，继续/重新 给各梦骑士上“疑惑”；敌毙为止\n\n\
其他四门提示:\n\n\
角色在敌触发圈之外亦可引到敌人: 1) 角色附近有尸体 2) 角色放的灵引到敌人 3) 角色打到敌人放的灵\n\
铸造厂内喊怪队员应与蛇保持较大的距离，否则蛇追近队员时会打敌人的灵 (既引到敌人)```\n\n";

var DOAtemplateAndLinksFrgn = "```js\n[Pasting video links into chat will display video]\n\n\
'1. MT': OwViMwfMpzcAhAFBYT25QTi7A              |  'https://www.youtube.com/watch?v=DPp4uJ8Ou-w'\n\
''                                              |  'https://www.youtube.com/watch?v=Ctojwl8sooI'\n\
'2. TT': OwFjUxf84QHQ6MhONQ0kdOIQ4O             |  'https://www.youtube.com/watch?v=T0B6KME0L8Q'\n\
'2. TT R/A'                                     |  'https://www.youtube.com/watch?v=KaLbLNuw-do'\n\
'2. TT Inner City Left Pull'                    |  'https://www.youtube.com/watch?v=n7Ys7b5VfOA'\n\
'2. TT Veil First 6 waves'                      |  'https://www.youtube.com/watch?v=cLUZxg851sg'\n\
'2. TT Veil Derv Underlord and Monk lord'       |  'https://www.youtube.com/watch?v=lupWQPC-mEg'\n\
'2. TT Gloom Cave (Earth Skipped)'              |  'https://www.youtube.com/watch?v=EDH8rk-s7W8'\n\
'2. TT Foundry Third Snake and Fury'            |  'https://www.youtube.com/watch?v=3vLIkuvnd3A'\n\
'3. Vor/Caller': OQJTAQBbVCu0tx0Z6JmUwZDA6AA    |  'https://www.youtube.com/watch?v=pyQQ7xWM924'\n\
'4. TK/Off-damage': OQdDAYsySLBnAIgyl2kIQ0kdOA  |  'https://www.youtube.com/watch?v=5VpS1yXvYJc'\n\
''                                              |  'https://www.youtube.com/watch?v=KQyYmTo37So'\n\
'5. MLK': OQhjAwCsYQLBnAmO2g3UTPcAxkA           |  'https://www.youtube.com/watch?v=MaD2q-ADwXU'\n\
'6. IAU/Fourth Mes':  OQRCAsw0SwJgpjN40jNpGwNI  |  'https://www.youtube.com/watch?v=_61cv2FhtX4'\n\
'7. Seeder': OwUS8YITLB5g3VylAExDME0l           |  'https://www.youtube.com/watch?v=1gb5kPwj7j4'\n\
'8. Emo': OgNDwcPPP3MtIJ5gEPkHX/aB              |  'https://www.youtube.com/watch?v=24l8iByoE9c'\n\
''                                              |  'https://www.youtube.com/watch?v=yakx2aWNfcM'```\n";
var DOAtemplateAndLinksFrgn2 = "```js\nOther Info:\n\n\
'Animated Path Log':      'https://www.youtube.com/watch?v=QQ0DAOc2fT0'\n\
'Frequently used terms':  'http://fbgmguild.com/showthread.php?tid=700'\n\
'Doa Notes':  'https://docs.google.com/document/d/1COKjs3TjZYg6WSvK0zzXybH5bCIZvOGS8JK0-md8f4w/edit?pref=2&pli=1'\n\
'Doa Supplements':        'http://fbgmguild.com/showthread.php?tid=537'```\n\
```Reminders and Guides:\n\n\
If you are being chased (have aggro), please do NOT bring aggro to main team; die ON the SPOT\n\
Please check that you have prot bond before spikes\n\
Read your skill bars\n\
If you need bond, you go to Emo for bond; Emo does not follow you; you indicate your position in party (1-8)\n\
All mesmers should follow the caller closely unless you are on quest; the caller is the Mesmer/Ranger\n\
When told NOT to take quest(s), please do NOT take quests AND do NOT accept quest rewards\n\
Display lightbringer ranks, if it is not maxed, take bounty\n\
Use options menu to increase gamma if Gloom cave is too dark (requires full screen mode)\n\n\
Gloom - The Greater Darkness:\n\n\
Do not move once you have begun attacking\n\
Switch to high energy set when needed\n\
First Wave:     use shield set, do not echo, save it for second wave\n\
Second Wave:    echo mistrust or esurge and spam them to different targets\n\
                Skills that can be used include: energy surge, wandering eye, cry of pain, and mistrust.\n\
                Skills that should not be used include: unnatural signet, visions of regret, and wastrels demise\n\
                                         (the last two has limited range and cannot reach all enemies at the same time)\n\
Third Wave:     no limit on skills, but to conserve energy, try not to spam single damage if enemy is not near death or if eoe has died```\n";
var DOAtemplateAndLinksFrgn3="```Foundry - The Fury:\n\n\
Once balled, mesmers should stand apart from each other and on the outer edge of enemy aggro bubble (without aggroing)\n\
Spread mistrust onto the dreamriders by using echo mistrust (if a target has already been hexed, pick another)\n\
While mistrust is recharging, use backfire on the Ki, along with other attack skills\n\
Reapply mistrust when recharged\n\n\
Other DOA  Notes:\n\n\
Your char can aggro if: 1) you are standing by a corpse 2) your spirit aggroes the enemy 3) you attack enemy spirit\n\
The calling member (seeder) in foundry should keep a good distance from the snakes while running\n\
otherwise the snakes, once sufficiently caught up, can begin to attack enemy spirits and aggro enemy```\n\n";

var FOWtemplateAndLinks = "```js\n[复制链接 并 向频道发送后 即可观看]\n\n\
'1. 领队': OwZSk4PTHQ6M0klC5i8QIQ4O   | 'https://www.youtube.com/watch?v=5qhfA_ZcIpw'\n\
'2. 游侠': OgcSc5PTHQ6M3lCHhOUQIQ4O   | 'https://www.youtube.com/watch?v=2AcxSQhRGY8'\n\
'3. 暗杀2': OwZSk4PTHQ6M0k5i8QtlIQ4O  | 'https://www.youtube.com/watch?v=5K9hf3FUvAw'\n\
'4. 神唤': OgGjkirMrSmXfbaXNXFF0lcXsX | '无，随大队杀敌；或观下方神唤部分 以悉大概杀敌办法'\n\
'5. 祭祀': OAKjYpiMJSQHXT0gYMeT2ktlXM | '无，祭祀或已被淘汰'\n\
'6. 僧':  OwkjAxNqJSME5gNgbETftl7Y0b  | 'https://www.youtube.com/watch?v=sH-hEw2pCsc'```\n\
```js\n四暗杀团: \n\n\
'1. 游侠1': OgcTc588Z6ASn5uU4YCaXEBC3BA       | 'https://www.youtube.com/watch?v=Z6ShVAs1Fkc'\n\
'2. 暗杀2': OwZTk4+8ZimUn5AC3JgJXkHqtEA       | 'https://www.youtube.com/watch?v=rC5Ay-r0_YY'\n\
'3. 游侠3': OgcTc588Z6ASnBBC3hm8uU4ozBA       | 'https://www.youtube.com/watch?v=P1n9arMGFyE'\n\
'4. 暗杀4': OwZTk4+8ZaCSn5AC3Jg5uMXkHCA       | 'https://www.youtube.com/watch?v=IvDEe5brIDI'\n\
'5. 领队':  Owlk0lf84YmENpOzBEuDCUuYb5NG      | 'https://www.youtube.com/watch?v=Ky_1ESxrg1U'\n\
'6. 神唤1': OgGkMJp2KzuEdZzFNp213m5F3F7F      | 'https://www.youtube.com/watch?v=6gaguHx7bhc'\n\
'7. 神唤2':  OgikIKp2KzuEdZzVuo213m5F3F7F     | 'https://www.youtube.com/watch?v=OLFjBIs1vQQ'\n\
'8. 神唤3': Ogek8Jp2KzuEuTzVuo213m5F3F7F      | 'https://www.youtube.com/watch?v=aMkZJe5e4Es'```\n";
var FOWtemplateAndLinks2 = "```js\n参考 - 可单人完成的部分: \n\n\
'1. (神唤) 勇气塔'                     | 'https://www.youtube.com/watch?v=KjQTknnxpjI'\n\
'2. (神唤) 营区'                       | 'https://www.youtube.com/watch?v=w7d28uvrc9w'\n\
'3. (神唤) 杀僧'                       | 'https://www.youtube.com/watch?v=DGfgqd4QwmM'\n\
'4. (神唤) 锻造厂'                     | 'https://www.youtube.com/watch?v=uEclml1ijbY'\n\
'5. (神唤) 力量塔'                     | 'https://www.youtube.com/watch?v=zg2QDeiUlwc'\n\
'6. (神唤) 电森林 桥'                  | 'https://www.youtube.com/watch?v=zbthrH-Yyr4'\n\
'7. (神唤) 狮鹫任务 勇气塔部分'         | 'https://www.youtube.com/watch?v=WDIB3dJGons'\n\
'8. (游侠) 蜘蛛洞 杀狼 '               | 'https://www.youtube.com/watch?v=69j75rI14l8'\n\
'9. (暗杀) 电森林 杀狼'                | 'https://www.youtube.com/watch?v=Iu974PdGeOE'```\n\n";


var FOWtemplateAndLinksFrgn = "```js\n[Pasting video links into chat will display video]\n\n\
'1. MT': OwZSk4PTHQ6M0klC5i8QIQ4O    | 'https://www.youtube.com/watch?v=5qhfA_ZcIpw'\n\
'2. T1s': OgcSc5PTHQ6M3lCHhOUQIQ4O   | 'https://www.youtube.com/watch?v=2AcxSQhRGY8'\n\
'3. T2s': OwZSk4PTHQ6M0k5i8QtlIQ4O   | 'https://www.youtube.com/watch?v=5K9hf3FUvAw'\n\
'4. Vos': OgGjkirMrSmXfbaXNXFF0lcXsX | '[N/A] See VoS section below for general tactics'\n\
'5. Rit': OAKjYpiMJSQHXT0gYMeT2ktlXM | '[N/A] No longer used'\n\
'6. UA':  OwkjAxNqJSME5gNgbETftl7Y0b | 'https://www.youtube.com/watch?v=sH-hEw2pCsc'```\n\
```js\nT4Way: \n\n\
'1. T1': OgcTc588Z6ASn5uU4YCaXEBC3BA       | 'https://www.youtube.com/watch?v=Z6ShVAs1Fkc'\n\
'2. T2': OwZTk4+8ZimUn5AC3JgJXkHqtEA       | 'https://www.youtube.com/watch?v=rC5Ay-r0_YY'\n\
'3. T3': OgcTc588Z6ASnBBC3hm8uU4ozBA       | 'https://www.youtube.com/watch?v=P1n9arMGFyE'\n\
'4. T4': OwZTk4+8ZaCSn5AC3Jg5uMXkHCA       | 'https://www.youtube.com/watch?v=IvDEe5brIDI'\n\
'5. MT':  Owlk0lf84YmENpOzBEuDCUuYb5NG     | 'https://www.youtube.com/watch?v=Ky_1ESxrg1U'\n\
'6. Vos 1': OgGkMJp2KzuEdZzFNp213m5F3F7F   | 'https://www.youtube.com/watch?v=6gaguHx7bhc'\n\
'7. Vos 2':  OgikIKp2KzuEdZzVuo213m5F3F7F  | 'https://www.youtube.com/watch?v=OLFjBIs1vQQ'\n\
'8. Vos 3': Ogek8Jp2KzuEuTzVuo213m5F3F7F   | 'https://www.youtube.com/watch?v=aMkZJe5e4Es'```\n";
var FOWtemplateAndLinksFrgn2 = "```js\nSupplement - Solo-able sections: \n\n\
'1. (VoS) Toc'                     | 'https://www.youtube.com/watch?v=KjQTknnxpjI'\n\
'2. (VoS) Camp'                    | 'https://www.youtube.com/watch?v=w7d28uvrc9w'\n\
'3. (VoS) Priest'                  | 'https://www.youtube.com/watch?v=DGfgqd4QwmM'\n\
'4. (VoS) Forge'                   | 'https://www.youtube.com/watch?v=uEclml1ijbY'\n\
'5. (VoS) ToS'                     | 'https://www.youtube.com/watch?v=zg2QDeiUlwc'\n\
'6. (VoS) Wailing Bridge'          | 'https://www.youtube.com/watch?v=zbthrH-Yyr4'\n\
'7. (VoS) Griffon ToC section'     | 'https://www.youtube.com/watch?v=WDIB3dJGons'\n\
'8. (Ranger) Cave Wolf'            | 'https://www.youtube.com/watch?v=69j75rI14l8'\n\
'9. (Assassin) Wailing Wolf'       | 'https://www.youtube.com/watch?v=Iu974PdGeOE'```\n\n";

var OTHERtemplateAndLinks = "```http://jizhan1.coding.me/%E5%85%B6%E4%BB%96%E9%80%9F%E6%88%90%E5%9B%A2\n\
https://www.youtube.com/channel/UC4s2Bl0Mnk-irMtUkncRd5g```";

var OTHERtemplateAndLinksFrgn = "```https://www.youtube.com/channel/UC4s2Bl0Mnk-irMtUkncRd5g```";

bot.loginWithToken("Bot MjE4NTAzNjYzODA5ODU1NDkw.CqEgnQ.FcBpuL9nxqA5LubmHwSS2D86B6Y");

/*
Useful links for learning JavaScript and Node:
codeCademy online course: https://www.codecademy.com/learn/javascript
Eloquent Javascript, free book: http://eloquentjavascript.net/
Some Node: http://nodeschool.io/ and https://www.codeschool.com/courses/real-time-web-with-node-js
Discord.js Getting Started Guide: https://eslachance.gitbooks.io/discord-js-bot-guide/content/
Javascript Reference/Docs: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference (do NOT use W3School!)
discord.js documentation http://discordjs.readthedocs.org/en/latest/
Rule #3 of this server: We're glad to help where we can, but come with at least a basic understanding of the programming language you intend to use.(edited)
How-To Bot: The following guide goes through everything you need to know on how to create a bot, code it, and run it. Before you ask any further question, please read this:
https://eslachance.gitbooks.io/discord-js-bot-guide/content/getting-started/the-long-version.html(edited)
*/
