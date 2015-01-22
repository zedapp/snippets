var session = require("zed/session");
var config = require("zed/config")
var configFs = require("zed/config_fs");
var ui = require("zed/ui");

function loadUserConfig() {
    return configFs.readFile("/user.json").then(function(text) {
        return JSON5.parse(text);
    });
}

function saveUserConfig(confJson) {
    return configFs.writeFile("/user.json", JSON5.stringify(confJson, null, 4));
}

function ensureSnippetsEntry(confJson, lang) {
    if (!confJson.modes) {
        confJson.modes = {};
    }
    if (!confJson.modes[lang]) {
        confJson.modes[lang] = {};
    }
    if (!confJson.modes[lang].commands) {
        confJson.modes[lang].commands = {}
    }
    if (!confJson.modes[lang].commands["Tools:Complete:Snippet"]) {
        confJson.modes[lang].commands["Tools:Complete:Snippet"] = {
            scriptUrl: "/default/command/snippet_completer.js",
            sandbox: "complete"
        };
        if (!confJson.modes[lang].handlers) {
            confJson.modes[lang].handlers = {};
        }
        if (!confJson.modes[lang].handlers.complete) {
            confJson.modes[lang].handlers.complete = [];
        }
        confJson.modes[lang].handlers.complete.push("Tools:Complete:Snippet");
    }
    if (!confJson.modes[lang].commands["Tools:Complete:Snippet"].snippets) {
        confJson.modes[lang].commands["Tools:Complete:Snippet"].snippets = {};
    }
    return confJson.modes[lang].commands["Tools:Complete:Snippet"].snippets;
}

function getSnippets(mode) {
    return mode && mode.commands["Tools:Complete:Snippet"] && mode.commands["Tools:Complete:Snippet"].snippets || {};
}

function list(mode) {
    return session.goto("zed::snippets").then(function() {
        session.setText("zed::snippets", "Snippets for " + mode.language + "\n======================\n[Create snippet] [Reload list]\n\nCurrent snippets\n----------------------\n\n");
        var snippets = getSnippets(mode);
        Object.keys(snippets).forEach(function(snippetName) {
            append(snippetName + " [Edit] [Remove]\n\n    " + snippets[snippetName].replace(/\n/g, "\n    ") + "\n\n");
        });
        if (Object.keys(snippets).length === 0) {
            append("No snippets yet!");
        }
    }).then(function() {
        return session.setCursorPosition("zed::snippets", {
            row: 0,
            column: 0
        });
    });

    function append(text) {
        session.append("zed::snippets", text);
    }
}

function addSnippet(lang) {
    var name;
    return ui.prompt("Snippet name:", "").then(function(name_) {
        name = name_;
        if (!name) {
            return;
        }
        return session.goto("zed::snippets::" + lang + "::" + name + ".snippet|write");
    });
}

function editSnippet(lang, name) {
    var docPath = "zed::snippets::" + lang + "::" + name + ".snippet";
    var text;
    config.getMode(lang).then(function(mode) {
        var snippets = getSnippets(mode);
        text = snippets[name];
        return session.goto(docPath + "|write");
    }).then(function() {
        session.setText(docPath, text);
    });
}

function removeSnippet(lang, name) {
    var configJson;
    var fullMode;
    return session.deleteSession("zed::snippets::" + lang + "::" + name + ".snippet").then(function() {
        return config.getMode(lang);
    }).then(function(fullMode_) {
        fullMode = fullMode_;
        return loadUserConfig();
    }).then(function(configJson_) {
        configJson = configJson_;
        var entry = ensureSnippetsEntry(configJson, lang);
        if (entry[name] === undefined) {
            return ui.prompt("Cannot remove a built-in snippet.");
        }
        delete entry[name];
        delete fullMode.commands["Tools:Complete:Snippet"].snippets[name];
        return saveUserConfig(configJson);
    }).then(function() {
        return list(fullMode);
    }).
    catch (function(err) {
        console.error("Error:", err.message);
    });
}

function extractIdentifier(line, startPos) {
    var name = '';
    startPos = startPos || 0;
    for (var i = startPos; i < line.length && line[i] !== ' '; i++) {
        name += line[i];
    }
    return name;
}

function getButton(line, pos) {
    var i = pos.column;
    while (i >= 0 && line[i] !== '[') {
        i--;
    }
    if (line[i] !== '[') {
        return;
    }
    i++;
    var name = '';
    while (i < line.length && line[i] !== ']') {
        name += line[i];
        i++;
    }
    if (line[i] !== ']') {
        return;
    }
    return name;
}

function execute(info) {
    var pos = info.inputs.cursor;
    var lines = info.inputs.lines;
    var line = lines[pos.row];
    var button = getButton(line, pos);
    var lang = extractIdentifier(lines[0], 13);
    if (!button) {
        return;
    }
    switch (button) {
        case "Create snippet":
            return addSnippet(lang);
        case "Reload list":
            return config.getMode(lang).then(function(mode) {
                return list(mode);
            });
        case "Edit":
            return editSnippet(lang, extractIdentifier(line, 0));
        case "Remove":
            return removeSnippet(lang, extractIdentifier(line, 0));
    }
}

var saveTimeout = null;

function save(info) {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    // We'll wait at least 5 seconds
    saveTimeout = setTimeout(function() {
        var parts = info.path.split("::");
        var modeName = parts[2];
        var snippetName = parts[3].split(".")[0];
        var text = info.inputs.text.replace(/^\s+|\s+$/g, "");
        return loadUserConfig().then(function(configJson) {
            var oldJson = JSON.stringify(configJson);
            var entry = ensureSnippetsEntry(configJson, modeName);
            entry[snippetName] = text;
            if (oldJson !== JSON.stringify(configJson)) {
                return saveUserConfig(configJson);
            } else {
                console.log("No changes");
            }
        }).
        catch (function(err) {
            console.error("Error:", err.message);
        });
    }, 5000);
}

module.exports = function(info) {
    switch (info.action) {
        case "list":
            list(info.inputs.mode);
            break;
        case "execute":
            execute(info);
            break;
        case "save":
            save(info);
            break;
        case "add":
            addSnippet(info.inputs.mode.language);
            break;
    }
}
