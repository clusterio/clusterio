Contributing to Clusterio
=========================

You are probably reading this because you want to contribute code to
Clusterio.  Great!  We need people like you.  Though we have some
conventions and workflows that we kindly ask you to follow.


Contents
--------

- [Workflow](#workflow)
    - [Starting a Feature Branch](#starting-a-feature-branch)
    - [Submitting a Pull Request](#submitting-a-pull-request)
    - [Editing your Feature Branch](#editing-your-feature-branch)
    - [Resolving Merge Conflicts](#resolving-merge-conflicts)
    - [Updating Your GitHub Fork](#updating-your-github-fork)
- [Changelog](#changelog)
- [Code Style](#code-style)
    - [Indenting](#indenting)
    - [Line Length](#line-length)


Workflow
--------

While we don't require you to follow this workflow, it makes things much
simpler for both you and us if you choose to do so.  Especially when it
comes to making the commit history reflect what happened and not be a
giant ball of mess.  GitHub's git workflow is less than ideal for
dealing with small feature-branches so you might see things being done
here a little diffrent than the usual.

It is recommended that you use the command line git version for doing
the operations described here.  GUI wrappers tend to have different
ideas of what is what and you might find it difficult to make it do the
things described here.  For doing the actual commits though, your
faviorit git GUI should work just fine.

If you pressed the fork button on GitHub and used `git clone` _on your
own fork_ you can skip to the next paragraph.  Otherwise you will have
to click the fork button and clone your fork.  If you already cloned the
main GitHub repository you can change your clone to point at your own
fork using the `git remote` command, but it's probably easier to delete
your local clone and clone it again.

To keep your local repository up to to date with the main repository add
the main repository as a remote.

    git remote add upstream https://github.com/clusterio/factorioClusterio

After this running `git fetch upstream` will get the updated branches
from the main repository.  Do not run `git pull upstream` it will mess
thing up!


### Starting a Feature Branch

Development is done exclusively in feature branches.  This means the
first thing to do before starting any development at all is to make a
new branch starting from the master or 1.2.x branch of the main
repository.  To do this check out that branch from the main repository
(substitute master for 1.2.x if you're working on that branch.)

    git fetch upstream
    git checkout upstream/master

This will give a warning about detached HEAD which means you did it
correctly.  Now you can make a feature branch based on this with.

    git checkout -b my-feature-branch

The name of the branch is not important, as long as it's not a name
you've used before.  But it's nice to have its name be somewhat
descriptive of what it implements.


### Submitting a Pull Request

Once you've commited changes to your feature branch that you want to
have included into the main repository push it to you fork with

    git push origin my-feature-branch

and make a pull request through the GitHub web interface.  You can also
pass the `--set-upstream` (or `-u`) flag to make `git push` do the same
thing for this branch.  After your feature branch have been merged you
should consider it final.  If there are more changes you want to have
merged or mistakes you need to fix you must start a new feature branch
and submit a new pull request


### Editing your Feature Branch

Until your feature branch is merged you can edit it as you see fit by
using the rebase tool.  If your feature branch has been merged however
it's final and you will have to start a new feature branch and submit
that in a new pull request.  The base usage of rebase assuming you are
checked out on your feature branch is the following command (substitute
master with 1.2.x if your feature branch is based on that)

    git rebase -i upstream/master

This will open up an editor with the commits of your feature branch and
let you reorder, edit, and remove commits as you see fit.

If the main repository has been updated and you have fetched down those
updates with `git fetch upstream` this will also move your feature
branch so that it is based on the latest commit from the main
repository.

If you have already pushed your feature branch to your fork a simple
`git push origin my-feature-branch` will no longer work as the histories
are different, instead you will have to run

    git push origin +my-feature-branch

The + sign signifies a force push and should be used with care.  If you
have a pull request that has not yet been merged submitted for this
feature branch this will update the pull request too.


### Resolving Merge Conflicts

The best way to resolve merge conflicts in feature braches is to rebase
it on top of the updated upstream.  Run the following commands
(substitute master with 1.2.x if your feature branch is based on that)

    git fetch upstream
    git rebase upstream/master

This will stop on the commit(s) that caused the merge conflict and let
you resolve them manually before continuing.  Once you're done force
push your updated feature branch with

    git push origin +my-feature-branch


### Updating Your GitHub Fork

No.  This is pointless busywork that accomplishes nothing.  Fetch the
main repository directly as described above and base your feature
branches on the refs from it.  GitHub has no interface or functionality
for keeping the branches in your fork up to date with the branches in
the main repository and there is no point in doing this for our feature
branch based workflow.


Changelog
---------

There's a [Changelog](../CHANGELOG.md) in the root of the project.  If
you make changes that are visible to users of this project you should
add an entry to the changelog describing what has changed.  The format
of this log should be self explanatory, please follow it carefully.


Code Style
----------

The style of the code is a bit of a mixed bag at the moment.  But there
are at least two things that have been agreed upon.


### Indenting

JavaScript code should be indented with tabs.  There are places in the
codebase that are mixing tabs and spaces or uses only spaces for
indents.  Should you be modifiying such code that is mixing spaces and
tabs as indending you should update the indenting to use tabs _on the
code you change_ while leaving the rest of the code untouched.


### Line Length

Lines are limited to 120 characters where tabs count as 4 characters.
If the argument list for a function or expressino for compound statement
gets very long break them out on their own line(s).  For example:

    function foo(
        really, long, argument, list,
        over, multiple, lines
    ) {
        if (
            really && long && expression
            || over && multiple && lines
        ) {
            // code
        }
    })
