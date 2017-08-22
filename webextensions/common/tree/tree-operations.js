/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

function attachTabTo(aChild, aParent, aInfo = {}) {
  if (!aParent || !aChild) {
    log('missing information: ', dumpTab(aParent), dumpTab(aChild));
    return;
  }
  log('attachTabTo: ', {
    parent:   dumpTab(aParent),
    children: aParent.getAttribute(kCHILDREN),
    child:    dumpTab(aChild),
    info:     aInfo
  });
  if (aParent.getAttribute(kCHILDREN).indexOf(`|${aChild.id}|`) > -1) {
    log('  => already attached');
    return;
  }
  var ancestors = [aParent].concat(getAncestorTabs(aChild));
  if (ancestors.indexOf(aChild) > -1) {
    log('  => canceled for recursive request');
    return;
  }

  detachTab(aChild);

  var newIndex = -1;
  if (aInfo.dontMove)
    aInfo.insertBefore = getNextTab(aChild);
  if (aInfo.insertBefore) {
    log('  insertBefore: ', dumpTab(aInfo.insertBefore));
    newIndex = getTabIndex(aInfo.insertBefore);
  }
  var childIds = [];
  if (newIndex > -1) {
    log('  newIndex (from insertBefore): ', newIndex);
    let expectedAllTabs = getAllTabs(aChild).filter((aTab) => aTab != aChild);
    let refIndex = expectedAllTabs.indexOf(aInfo.insertBefore);
    expectedAllTabs.splice(refIndex, 0, aChild);
    childIds = expectedAllTabs.filter((aTab) => {
      return (aTab == aChild || aTab.getAttribute(kPARENT) == aParent.id);
    }).map((aTab) => {
      return aTab.id;
    });
  }
  else {
    let descendants = getDescendantTabs(aParent);
    log('  descendants: ', descendants.map(dumpTab));
    if (descendants.length) {
      newIndex = getTabIndex(descendants[descendants.length-1]) + 1;
    }
    else {
      newIndex = getTabIndex(aParent) + 1;
    }
    log('  newIndex (from existing children): ', newIndex);
    // update and cleanup
    let children = getChildTabs(aParent);
    children.push(aChild);
    childIds = children.map((aTab) => aTab.id);
  }

  if (childIds.length == 0)
    aParent.setAttribute(kCHILDREN, '|');
  else
    aParent.setAttribute(kCHILDREN, `|${childIds.join('|')}|`);

  if (getTabIndex(aChild) < newIndex)
    newIndex--;
  log('  newIndex: ', newIndex);

  aChild.setAttribute(kPARENT, aParent.id);
  var parentLevel = parseInt(aParent.getAttribute(kNEST) || 0);
  updateTabsIndent(aChild, parentLevel + 1);

  gInternalMovingCount++;
  var nextTab = getTabs(aChild)[newIndex];
  if (nextTab != aChild)
    getTabsContainer(nextTab || aChild).insertBefore(aChild, nextTab);
  getApiTabIndex(aChild.apiTab.id, nextTab.apiTab.id).then((aActualIndexes) => {
    log('  actual indexes: ', aActualIndexes);
    var [actualChildIndex, actualNewIndex] = aActualIndexes;
    if (actualChildIndex < actualNewIndex)
      actualNewIndex--;
    log('  actualNewIndex: ', actualNewIndex);
    browser.tabs.move(aChild.apiTab.id, { windowId: aChild.apiTab.windowId, index: actualNewIndex });
    setTimeout(() => {
      gInternalMovingCount--;
    });
  });
}

function detachTab(aChild, aInfo = {}) {
  log('detachTab: ', dumpTab(aChild), aInfo);
  var parent = getParentTab(aChild);
  if (!parent) {
    log('  detachTab: canceled for an orphan tab');
    return;
  }

  var childIds = parent.getAttribute(kCHILDREN).split('|').filter((aId) => aId && aId != aChild.id);
  if (childIds.length == 0)
    parent.setAttribute(kCHILDREN, '|');
  else
    parent.setAttribute(kCHILDREN, `|${childIds.join('|')}|`);
  log('  children => ', parent.getAttribute(kCHILDREN));
  aChild.removeAttribute(kPARENT);

  updateTabsIndent(aChild);
}

function detachAllChildren(aTab, aInfo = {}) {
  var children = getChildTabs(aTab);
  if (!children.length)
    return;

  if (!('behavior' in aInfo))
    aInfo.behavior = kCLOSE_PARENT_BEHAVIOR_SIMPLY_DETACH_ALL_CHILDREN;
  if (aInfo.behavior == kCLOSE_PARENT_BEHAVIOR_CLOSE_ALL_CHILDREN)
    aInfo.behavior = kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD;

  aInfo.dontUpdateInsertionPositionInfo = true;

  var parent = getParentTab(aTab);
  if (isGroupTab(aTab) &&
      getTabs(aTab).filter((aTab) => aTab.removing).length == children.length) {
    aInfo.behavior = kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN;
    aInfo.dontUpdateIndent = false;
  }

  var nextTab = null;
  if (aInfo.behavior == kCLOSE_PARENT_BEHAVIOR_DETACH_ALL_CHILDREN/* &&
    !utils.getTreePref('closeParentBehavior.moveDetachedTabsToBottom')*/) {
    nextTab = getNextSiblingTab(getRootTab(aTab));
  }

  if (aInfo.behavior == kCLOSE_PARENT_BEHAVIOR_REPLACE_WITH_GROUP_TAB) {
    // open new group tab and replace the detaching tab with it.
    aInfo.behavior = kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN;
  }

  for (let i = 0, maxi = children.length; i < maxi; i++) {
    let child = children[i];
    if (aInfo.behavior == kCLOSE_PARENT_BEHAVIOR_DETACH_ALL_CHILDREN) {
      detachTab(child, aInfo);
      //moveTabSubtreeTo(tab, nextTab ? nextTab._tPos - 1 : this.getLastTab(b)._tPos );
    }
    else if (aInfo.behavior == kCLOSE_PARENT_BEHAVIOR_PROMOTE_FIRST_CHILD) {
      detachTab(child, aInfo);
      if (i == 0) {
        if (parent) {
          attachTabTo(child, parent, inherit(aInfo, {
            dontExpand : true,
            dontMove   : true
          }));
        }
        //collapseExpandSubtree(child, false);
        //deleteTabValue(child, kSUBTREE_COLLAPSED);
      }
      else {
        attachTabTo(child, children[0], inherit(aInfo, {
          dontExpand : true,
          dontMove   : true
        }));
      }
    }
    else if (aInfo.behavior == kCLOSE_PARENT_BEHAVIOR_PROMOTE_ALL_CHILDREN && parent) {
      attachTabTo(child, parent, inherit(aInfo, {
        dontExpand : true,
        dontMove   : true
      }));
    }
    else { // aInfo.behavior == kCLOSE_PARENT_BEHAVIOR_SIMPLY_DETACH_ALL_CHILDREN
      detachTab(child, aInfo);
    }
  }
}

function updateTabsIndent(aTabs, aLevel = undefined) {
  if (!aTabs)
    return;

  if (!Array.isArray(aTabs))
    aTabs = [aTabs];

  if (!aTabs.length)
    return;

  if (aLevel === undefined)
    aLevel = getAncestorTabs(aTabs[0]).length;

  var margin = 16;
  for (let i = 0, maxi = aTabs.length; i < maxi; i++) {
    let item = aTabs[i];
    if (!item)
      continue;
    window.requestAnimationFrame(() => {
      var level = parseInt(item.getAttribute(kNEST) || 0);
      var indent = level * margin;
      var expected = indent == 0 ? 0 : indent + 'px' ;
      log ('setting indent: ', { tab: dumpTab(item), expected: expected, level: level });
      if (item.style.marginLeft != expected) {
        window.requestAnimationFrame(() => item.style.marginLeft = expected);
      }
    });
    item.setAttribute(kNEST, aLevel);
    updateTabsIndent(getChildTabs(item), aLevel + 1);
  }
}

// operate tabs based on tree information

function closeChildTabs(aParent) {
  var getDescendantTabs;
}

